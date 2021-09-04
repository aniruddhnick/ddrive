const debug = require('debug')('discordAPI')
const fetch = require('node-fetch')
const FormData = require('form-data')
const { Agent } = require('https')
const AsyncQueue = require('./utils/asyncQueue')

const agent = new Agent({ keepAlive: true })

class Rest {
    constructor() {
        this.retries = 3 // 500 errors
        this.baseURL = 'https://discord.com/api'
        this.version = 9
        this.offset = 50
        this.token = undefined
        this.queue = new AsyncQueue()
    }

    setVersion(ver) {
        this.version = ver

        return this
    }

    setToken(token) {
        this.token = token

        return this
    }

    get(route, options) {
        return this.request(route, options, 'get')
    }

    post(route, options) {
        return this.request(route, options, 'post')
    }

    put(route, options) {
        return this.request(route, options, 'put')
    }

    patch(route, options) {
        return this.request(route, options, 'patch')
    }

    delete(route, options) {
        return this.request(route, options, 'delete')
    }

    request(route, options, method) {
        const { url, fetchOptions } = this.resolveRequest({ ...options, route })

        return this.queueRequest(url, { ...fetchOptions, method })
    }

    async queueRequest(url, fetchOptions) {
        await this.queue.wait()
        try {
            console.log(this.limited, this.timeToRest)
            if (this.limited) await new Promise((r) => setTimeout(r, this.timeToRest))

            // Make the request, and return the results
            return await this.runRequest(url, fetchOptions)
        } finally {
            // Allow the next request to fire
            this.queue.shift()
        }
    }

    get limited() {
        return this.remaining <= 0 && Date.now() < this.reset
    }

    get timeToRest() {
        return this.reset - Date.now()
    }

    async runRequest(url, fetchOptions, retries = 0) {
        const res = await fetch(url, fetchOptions)

        let retryAfter = 0

        const method = fetchOptions.method || 'get'
        const remaining = res.headers.get('X-RateLimit-Remaining')
        const reset = res.headers.get('X-RateLimit-Reset-After')
        const retry = res.headers.get('Retry-After')
        // console.log(retry, remaining)
        // Update the number of remaining requests that can be made before the rate limit resets
        this.remaining = remaining ? Number(remaining) : 1
        // Update the time when this rate limit resets (reset-after is in seconds)
        this.reset = reset ? Number(reset) * 1000 + Date.now() + this.offset : Date.now()
        console.log(remaining, this.remaining, Number(reset) * 1000)
        // Amount of time in milliseconds until we should retry if rate limited (globally or otherwise)
        if (retry) retryAfter = Number(retry) * 1000 + this.offset

        // Handle global rate limit
        if (res.headers.get('X-RateLimit-Global')) {
            debug(`We are globally rate limited, blocking all requests for ${retryAfter}ms`)
            // Set the manager's global timeout as the promise for other requests to "wait"
            await new Promise((r) => setTimeout(r, retryAfter))
        }
        if (res.ok) return this.parseResponse(res)
        if (res.status === 429) {
            // A rate limit was hit - this may happen if the route isn't associated with an official bucket hash yet, or when first globally rate limited
            debug(
                [
                    'Encountered unexpected 429 rate limit',
                    `  Route          : ${url}`,
                    `  Retry After    : ${retryAfter}ms`,
                ].join('\n'),
            )
            // Wait the retryAfter amount of time before retrying the request
            await new Promise((r) => setTimeout(r, retryAfter))
            // Since this is not a server side issue, the next request should pass, so we don't bump the retries counter

            return this.runRequest(url, fetchOptions, retries)
        }
        if (res.status >= 500 && res.status < 600) {
            // Retry the specified number of times for possible server side issues
            if (retries !== this.retries) {
                return this.runRequest(url, fetchOptions, retries + 1)
            }

            throw this.HTTPError(res.statusText, res.status, method, url)
        }
        // Handle possible malformed requests
        if (res.status >= 400 && res.status < 500) {
            // If we receive this status code, it means the token we had is no longer valid.
            if (res.status === 401) {
                this.setToken(undefined)
            }
            // The request will not succeed for some reason, parse the error returned from the api
            const data = (await this.parseResponse(res))
            // throw the API error
            throw this.HTTPError(res.statusText, res.status, method, url, data)
        }

        return null
    }

    HTTPError(message, status, method, url, data) {
        const error = new Error(message)
        Object.assign(error, {
            status, method, url, data,
        })

        return error
    }

    /**
     * Prepare request payload
     * @Private
     * @param request
     * @return {{url, fetchOptions}}
     */
    resolveRequest(request) {
        let query = ''

        // If a query option is passed, use it
        if (request.query) {
            query = `?${request.query.toString()}`
        }

        // Create the required headers
        const headers = { }

        // If this request requires authorization (allowing non-"authorized" requests for webhooks)
        if (request.auth !== false) {
            // If we haven't received a token, throw an error
            if (!this.token) {
                throw new Error('Expected token to be set for this request, but none was present')
            }

            headers.Authorization = `${request.authPrefix === '' ? '' : 'Bot'} ${this.token}`
        }

        // Format the full request URL (api base, optional version, endpoint, optional querystring)
        const url = `${this.baseURL}/v${this.version}${request.route}${query}`

        let finalBody
        let additionalHeaders = {}

        if (request.attachments && request.attachments.length) {
            const formData = new FormData()

            // Attach all files to the request
            // eslint-disable-next-line no-restricted-syntax
            for (const attachment of request.attachments) {
                formData.append(attachment.fileName, attachment.rawBuffer, attachment.fileName)
            }

            // If a JSON body was added as well, attach it to the form data
            if (request.body) {
                formData.append('payload_json', JSON.stringify(request.body))
            }

            // Set the final body to the form data
            finalBody = formData
            // Set the additional headers to the form data ones
            additionalHeaders = formData.getHeaders()
        } else if (request.body) {
            // Stringify the JSON data
            finalBody = JSON.stringify(request.body)
            // Set the additional headers to specify the content-type
            additionalHeaders = { 'Content-Type': 'application/json' }
        }

        const fetchOptions = {
            agent,
            body: finalBody,
            headers: { ...(request.headers || {}), ...additionalHeaders, ...headers },
            method: request.method,
        }

        return { url, fetchOptions }
    }

    parseResponse(nodeRes) {
        const contentType = nodeRes.headers.get('Content-Type')
        if (contentType && contentType.startsWith('application/json')) return nodeRes.json()

        return nodeRes.buffer()
    }
}

module.exports = Rest
