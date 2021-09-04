
class AsyncQueue {
    constructor() {
        this.promises = []
    }

    /**
     * Waits for last promise and queues a new one
     * @return {*|Promise<void>}
     */
    wait() {
        const next = this.promises.length ? this.promises[this.promises.length - 1].promise : Promise.resolve()
        let resolve
        const promise = new Promise((res) => {
            resolve = res
        })

        this.promises.push({
            resolve,
            promise,
        })

        return next
    }

    /**
     * Frees the queue's lock for the next item to process
     * Resolve last promise
     */
    shift() {
        const deferred = this.promises.shift()
        if (typeof deferred !== 'undefined') deferred.resolve()
    }

    /**
     * Return pending promises
     * @return {Number}
     */
    get remaining() {
        return this.promises.length
    }
}

module.exports = AsyncQueue
