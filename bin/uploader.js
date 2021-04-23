/* eslint-disable no-restricted-syntax,no-await-in-loop */
require('dotenv').config()
const fs = require('fs')
const path = require('path')
const Discord = require('discord.js')
const uploader = require('../helpers/uploader')

const uploadDirPath = process.env.UPLOAD_DIR_PATH

const bot = new Discord.Client()

bot.login(process.env.TOKEN).then(async () => {
    console.log(`${bot.user.username} started!`)
    const channelId = process.env.STORAGE_CHANNEL
    const channel = await bot.channels.fetch(channelId)
    const run = async () => {
        console.log('Looking for files...')
        await new Promise(r => setTimeout(r, 5000))
        let files = fs.readdirSync(uploadDirPath)
        files = files.map(file => `${uploadDirPath}/${file}`)

        for (const file of files) {
            const stream = fs.createReadStream(file)
            await uploader(stream, path.basename(file), channel)
            fs.unlinkSync(file)
        }
        run().then()
    }

    run().then()
})
