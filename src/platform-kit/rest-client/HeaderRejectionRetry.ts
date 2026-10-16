import { CancelledError } from "@tutao/app-env"
import { HttpResponse, RestTextBody } from "@tutao/http-client"
import { ConnectionError } from "@tutao/http-client/error"

const MAX_ATTEMPTS = 5
const INITIAL_RETRY_DELAY_MS = 250

/**
 * Retry only the observed HTTP parser rejection, which happens before the request reaches
 * the application. Other 400s, authentication errors and ambiguous network failures must
 * retain their normal handling, especially for requests that change server state.
 */
export async function retryHeaderRejection(request: () => Promise<HttpResponse>, signal: AbortSignal | null): Promise<HttpResponse> {
	for (let attempt = 0; ; attempt++) {
		if (signal?.aborted === true) throw new CancelledError("Request cancelled before header-rejection retry")
		const response = await request()
		if (!isHeaderRejection(response)) return response
		if (attempt === MAX_ATTEMPTS - 1) {
			// This is a transport failure, not invalid credentials or malformed application data.
			throw new ConnectionError(`Server rejected HTTP headers after ${MAX_ATTEMPTS} attempts (Illegal header name Content-Length)`)
		}
		await waitForRetry(INITIAL_RETRY_DELAY_MS * 2 ** attempt, signal)
	}
}

function isHeaderRejection(response: HttpResponse): boolean {
	return (
		response.status === 400 &&
		response.getResponseHeader("Error-Id") == null &&
		response.getResponseHeader("content-type")?.split(";", 1)[0].trim().toLowerCase() === "text/html" &&
		response.body instanceof RestTextBody &&
		/<h2>\s*HTTP ERROR 400 Illegal header name Content-Length\s*<\/h2>/.test(response.body.payload) &&
		/<td>\s*\/badRequest\s*<\/td>/.test(response.body.payload)
	)
}

function waitForRetry(milliseconds: number, signal: AbortSignal | null): Promise<void> {
	return new Promise((resolve, reject) => {
		const onAbort = (): void => {
			clearTimeout(timer)
			signal?.removeEventListener("abort", onAbort)
			reject(new CancelledError("Request cancelled while waiting to retry rejected HTTP headers"))
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort)
			resolve()
		}, milliseconds)
		signal?.addEventListener("abort", onAbort, { once: true })
		if (signal?.aborted === true) onAbort()
	})
}
