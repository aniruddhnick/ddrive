const http = require('http')
const path = require('path')
const fs = require('fs')
const bot = require('./bot')
const downloader = require('./helpers/downloader')

const downloadLock = new Set()

/** Load static files * */
// const homePage = fs.readFileSync('./html/index.html')
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
    if (!database[fileName]) {
        res.status = 404
        res.end('404 not found')
    } else {
        downloadLock.add(fileName)
        res.status = 200
        await downloader(res, database[fileName], fileName)
        downloadLock.delete(fileName)
    }
}

/** Send homepage * */
const generateHomepage = (container) => {
    const { database } = container
    const homePage = fs.readFileSync('./html/index.html').toString()
    let files = Object.keys(database)
    files = files.map(file => `<p><a href="/${file}">${file}</a></p>`)

    return homePage.replace('{{PLACE_HOLDER}}', files.join('\n'))
}

/** Get URI to be used in cli downloader * */
const handleURI = (container, req, res) => {
    const { database } = container
    const fileName = path.basename(req.url)
    const payload = { fileName, files: database[fileName] }
    res.writeHead(200)
    res.end(convertToBase64(payload))
}

/** Router * */
bot.build()
    .then((container) => {
        const onRequest = async (req, res) => {
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
                    res.writeHead(200, { Connection: 'close' })
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
    })
