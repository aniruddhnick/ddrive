require('dotenv').config()
const http = require('http')
const path = require('path')
const fs = require('fs')
const request = require('request-promise-native')
const downloader = require('./helpers/downloader')
const humanReadableSize = require('./util/humanReadableSize')

/** Load static files * */
const homePage = fs.readFileSync('./html/index.html')
    .toString()

const favicon = fs.readFileSync('./html/favicon.ico')

/** Convert Object to base64 * */
const convertToBase64 = payload => Buffer.from(JSON.stringify(payload)).toString('base64')

/** send favicon * */
const sendFavicon = (req, res) => {
    res.writeHead(200)
    res.end(favicon)
}

/** Download file handler * */
const handleDownload = async (container, req, res) => {
    const { database } = container
    const fileName = path.basename(req.url)
    if (!database.data[fileName]) {
        res.status = 404
        res.end('404 not found')
    } else {
        res.status = 200
        res.writeHead(200, { 'Content-Length': database.data[fileName].size })
        await downloader(res, database.data[fileName].files, fileName)
    }
}

/** Send homepage * */
const generateHomepage = (container) => {
    const { database } = container
    let files = Object.keys(database.data)
    files = files.map(file => `<p><a href="/${file}">${file}</a></p>`)

    return homePage.replace('{{PLACE_HOLDER}}', files.join('\n'))
        .replace('{{SIZE}}', humanReadableSize(database.meta.size))
}

/** Get URI to be used in cli downloader * */
const handleURI = (container, req, res) => {
    const { database } = container
    const fileName = path.basename(req.url)
    const payload = { fileName, files: database[fileName].files }
    res.writeHead(200)
    res.end(convertToBase64(payload))
}

const genIndex = async () => {
    if (process.env.INDEX_PATH) return JSON.parse(fs.readFileSync(process.env.INDEX_PATH).toString())
    const database = await request.get(process.env.CDN_URL, {
        auth: {
            user: process.env.CDN_USER,
            password: process.env.CDN_PASSWORD,
        },
        json: true,
    })

    return database
}

const build = async () => {
    const container = {}
    container.database = await genIndex()
    console.log(`==== Size => ${humanReadableSize(container.database.meta.size)}`)
    console.log(`==== Chunks => ${container.database.meta.length}`)
    const onRequest = async (req, res) => {
        if (!container.database) {
            res.statusCode = 501
            res.end('Building Index in progress')

            return
        }
        try {
            if (req.url === '/favicon.ico') {
                sendFavicon(req, res)
            } else if (req.method === 'OPTIONS') {
                res.writeHead(200, {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS, DELETE',
                    'Access-Control-Allow-Headers': 'Content-Type, Content-Disposition',
                    'Access-Control-Max-Age': 86400,
                    'Content-Length': 0,
                })
                res.end()
            } else if (req.method === 'GET' && req.url.startsWith('/uri/')) {
                await handleURI(container, req, res)
            } else if (req.method === 'GET' && req.url !== '/') {
                await handleDownload(container, req, res)
            } else if (req.method === 'GET') {
                res.writeHead(200, { Connection: 'close', 'Content-Type': 'text/html' })
                res.end(generateHomepage(container))
            } else {
                res.writeHead(404)
                res.end('not found')
            }
        } catch (err) {
            console.log(err)
            res.writeHead(500)
            res.end('Internal server error')
        }
    }

    http.createServer(onRequest)
        .listen(process.env.PORT, () => {
            console.log(`App started at http://localhost:${process.env.PORT}`)
        })
    setInterval(async () => {
        try {
            container.database = await genIndex()
        } catch (err) {
            console.log(`==== gen index error => ${err.message}`)
        }
    }, 1800000)
}

build().then()
