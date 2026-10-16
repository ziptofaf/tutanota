import o from "@tutao/otest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { CancelledError } from "../../../src/platform-kit/app-env"
import { HttpClientJavascript, HttpMethod, MediaType, RestTextBody } from "../../../src/platform-kit/http-client"
import { BadRequestError, ConnectionError, NotAuthenticatedError } from "../../../src/platform-kit/http-client/error"
import { DEFAULT_REST_CLIENT_OPTIONS, RestClient } from "../../../src/platform-kit/rest-client/RestClient"
import { SuspensionHandler } from "../../../src/platform-kit/rest-client/SuspensionHandler"
import type { DomainConfig } from "../../../src/platform-kit/app-env"

const HEADER_REJECTION = `<!doctype html><html><head><title>Error 400 Illegal header name Content-Length</title></head>
<body><h2>HTTP ERROR 400 Illegal header name Content-Length</h2>
<table><tr><th>URI:</th><td>/badRequest</td></tr><tr><th>STATUS:</th><td>400</td></tr>
<tr><th>MESSAGE:</th><td>Illegal header name Content-Length</td></tr></table></body></html>`

// Exercise real XHR -> HttpClientJavascript -> RestClient, without a Tuta server or account.
o.spec("HeaderRejectionRetry", () => {
	let server: http.Server
	let client: RestClient
	let requests: number
	let respond: (req: http.IncomingMessage, res: http.ServerResponse) => void

	o.before(async () => {
		server = http.createServer((req, res) => {
			requests++
			respond(req, res)
		})
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
		client = new RestClient(
			new SuspensionHandler(globalThis, () => {}),
			{ apiUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` } as DomainConfig,
			"0",
			new HttpClientJavascript(),
		)
	})
	o.beforeEach(() => {
		requests = 0
	})
	o.after(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()))
	})

	for (const responseType of [MediaType.Json, MediaType.Binary, null]) {
		o(`recovers on attempt five with response type ${responseType}`, async () => {
			o.timeout(6000)
			respond = (_req, res) => {
				if (requests < 5) {
					res.writeHead(400, { "Content-Type": "text/html;charset=iso-8859-1" })
					res.end(HEADER_REJECTION)
				} else {
					res.end("ok")
				}
			}
			const result = await client.request("/startup", HttpMethod.GET, { ...DEFAULT_REST_CLIENT_OPTIONS, responseType })
			o(requests).equals(5)
			if (responseType === MediaType.Binary) o(Array.from(result)).deepEquals([111, 107])
			else o(result).equals(responseType === null ? null : "ok")
		})
	}

	o("replays a parser-rejected POST with its original body", async () => {
		o.timeout(1500)
		const bodies: string[] = []
		respond = (req, res) => {
			let body = ""
			req.on("data", (chunk) => (body += chunk.toString()))
			req.on("end", () => {
				bodies.push(body)
				if (requests === 1) {
					res.writeHead(400, { "Content-Type": "text/html" })
					res.end(HEADER_REJECTION)
				} else {
					res.writeHead(201)
					res.end("ok")
				}
			})
		}
		const result = await client.request("/session", HttpMethod.POST, {
			...DEFAULT_REST_CLIENT_OPTIONS,
			body: new RestTextBody('{"test":true}'),
			responseType: MediaType.Json,
		})
		o(result).equals("ok")
		o(bodies).deepEquals(['{"test":true}', '{"test":true}'])
	})

	for (const [name, body, contentType, errorId] of [
		["ordinary HTML 400", "<h2>Bad input</h2>", "text/html", null],
		["JSON application error", HEADER_REJECTION, "application/json", null],
		["application Error-Id", HEADER_REJECTION, "text/html", "application-error"],
		["unrelated URI", HEADER_REJECTION.replace("/badRequest", "/application"), "text/html", null],
		["oversized HTML body", HEADER_REJECTION + "x".repeat(17000), "text/html", null],
	]) {
		o(`does not retry ${name}`, async () => {
			respond = (_req, res) => {
				res.writeHead(400, { "Content-Type": contentType!, ...(errorId ? { "Error-Id": errorId } : {}) })
				res.end(body)
			}
			await o(() => client.request("/invalid", HttpMethod.POST, { ...DEFAULT_REST_CLIENT_OPTIONS, responseType: MediaType.Json })).asyncThrows(
				BadRequestError,
			)
			o(requests).equals(1)
		})
	}

	o("does not retry invalid credentials", async () => {
		respond = (_req, res) => {
			res.writeHead(401, { "Content-Type": "text/html" })
			res.end(HEADER_REJECTION)
		}
		await o(() => client.request("/session", HttpMethod.POST, DEFAULT_REST_CLIENT_OPTIONS)).asyncThrows(NotAuthenticatedError)
		o(requests).equals(1)
	})

	o("reports a connection error after five rejected attempts", async () => {
		o.timeout(6000)
		respond = (_req, res) => {
			res.writeHead(400, { "Content-Type": "text/html" })
			res.end(HEADER_REJECTION)
		}
		await o(() => client.request("/startup", HttpMethod.GET, DEFAULT_REST_CLIENT_OPTIONS)).asyncThrows(ConnectionError)
		o(requests).equals(5)
	})

	o("aborting during backoff prevents any further requests", async () => {
		o.timeout(1500)
		const controller = new AbortController()
		respond = (_req, res) => {
			res.writeHead(400, { "Content-Type": "text/html" })
			res.end(HEADER_REJECTION)
			setTimeout(() => controller.abort(), 50)
		}
		await o(() => client.request("/startup", HttpMethod.GET, { ...DEFAULT_REST_CLIENT_OPTIONS, abortSignal: controller.signal })).asyncThrows(
			CancelledError,
		)
		await new Promise((resolve) => setTimeout(resolve, 350))
		o(requests).equals(1)
	})

	o("an already cancelled request is never sent", async () => {
		const controller = new AbortController()
		controller.abort()
		await o(() => client.request("/startup", HttpMethod.GET, { ...DEFAULT_REST_CLIENT_OPTIONS, abortSignal: controller.signal })).asyncThrows(
			CancelledError,
		)
		o(requests).equals(0)
	})
})
