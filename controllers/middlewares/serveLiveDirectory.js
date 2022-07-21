const LiveDirectory = require('live-directory')
const serveUtils = require('../utils/serveUtils')

class ServeLiveDirectory {
  instance

  #options

  constructor (instanceOptions = {}, options = {}) {
    if (!instanceOptions.ignore) {
      instanceOptions.ignore = path => {
        // ignore dot files
        return path.startsWith('.')
      }
    }

    this.instance = new LiveDirectory(instanceOptions)

    if (options.setHeaders && typeof options.setHeaders !== 'function') {
      throw new TypeError('Middleware option setHeaders must be a function')
    }

    this.#options = options
  }

  #middleware (req, res, next) {
    // Only process GET and HEAD requests
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next()
    }

    const file = this.instance.get(req.path)
    if (file === undefined) {
      return next()
    }

    // set header fields
    this.#setHeaders(req, res, file)

    // set content-type
    res.type(file.extension)

    // conditional GET support
    if (serveUtils.isConditionalGET(req)) {
      if (serveUtils.isPreconditionFailure(req, res)) {
        return res.status(412).end()
      }

      if (serveUtils.isFresh(req, res)) {
        return res.status(304).end()
      }
    }

    // HEAD support
    if (req.method === 'HEAD') {
      return res.end()
    }

    return res.send(file.buffer)
  }

  #setHeaders (req, res, file) {
    // Always do external setHeaders function first,
    // in case it will overwrite the following default headers anyways
    if (this.#options.setHeaders) {
      this.#options.setHeaders(req, res)
    }

    if (!res.get('Last-Modified')) {
      const modified = new Date(file.last_update).toUTCString()
      res.header('Last-Modified', modified)
    }

    if (!res.get('ETag')) {
      const val = file.etag
      res.header('ETag', val)
    }
  }

  get middleware () {
    return this.#middleware.bind(this)
  }
}

module.exports = ServeLiveDirectory
