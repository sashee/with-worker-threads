import {describe, it, mock} from "node:test";
import { strict as assert } from "node:assert";
import crypto from "node:crypto";
import path from "node:path";
import url from "node:url";
import util from "node:util";
import {hello, div, helloBuffer, withPort} from "./worker.js";
import {withWorkerThreads} from "../index.js";

export type Pool = {
	hello: typeof hello,
	div: typeof div,
	helloBuffer: typeof helloBuffer,
	withPort: typeof withPort,
};

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

process.on('unhandledRejection', (error, p) => {
	console.log("UNHANDLED REJECTION")
	console.log(util.inspect(error))
	console.log("unhandled", util.inspect(p))
});

describe("basic", () => {
	it("allows calling the worker thread pool with simple data", async () => {
		await withWorkerThreads<Pool>({
			hello: (task) => (...args) => task(args),
			div: (task) => (...args) => task(args),
			helloBuffer: (task) => (...args) => task(args),
			withPort: (task) => (port, ...rest) => task([port, ...rest], [port]),
		})(path.join(__dirname, "worker.js"), {concurrency: 1})(async (pool) => {
			const result = await pool!.hello("World");
			assert.equal(result, "Hello World!");
		})
	});
	it("allows multiple arguments", async () => {
		await withWorkerThreads<Pool>({
			hello: (task) => (...args) => task(args),
			div: (task) => (...args) => task(args),
			helloBuffer: (task) => (...args) => task(args),
			withPort: (task) => (port, ...rest) => task([port, ...rest], [port]),
		})(path.join(__dirname, "worker.js"))(async (pool) => {
			const result = await pool!.div(4,2);
			assert.equal(result, 2);
		})
	});
	it("propagates exceptions", async () => {
		await withWorkerThreads<Pool>({
			hello: (task) => (...args) => task(args),
			div: (task) => (...args) => task(args),
			helloBuffer: (task) => (...args) => task(args),
			withPort: (task) => (port, ...rest) => task([port, ...rest], [port]),
		})(path.join(__dirname, "worker.js"))(async (pool) => {
			await assert.rejects(pool!.div(4,0));
		})
	});
	it("handles transferred results", async () => {
		await withWorkerThreads<Pool>({
			hello: (task) => (...args) => task(args),
			div: (task) => (...args) => task(args),
			helloBuffer: (task) => (...args) => task(args),
			withPort: (task) => (port, ...rest) => task([port, ...rest], [port]),
		})(path.join(__dirname, "worker.js"))(async (pool) => {
			const result = await pool!.helloBuffer("World");
			assert.equal(Buffer.from(result).toString("utf8"), "Hello World!");
		})
	});
	it("allows transferring parameters", async () => {
		await withWorkerThreads<Pool>({
			hello: (task) => (...args) => task(args),
			div: (task) => (...args) => task(args),
			helloBuffer: (task) => (...args) => task(args),
			withPort: (task) => (port, ...rest) => task([port, ...rest], [port]),
		})(path.join(__dirname, "worker.js"))(async (pool) => {
			const createPort = () => {
				const channel = new MessageChannel();
				channel.port2.onmessage = async ({data: msg, ports}) => {
					try {
						const result = "[" + msg.data + "]";
						ports[0].postMessage({data: result});
					}catch(e) {
						console.error(e);
						ports[0].postMessage({error: e});
					}
				}
				return channel.port1;
			}
			const port = createPort();
			const result = await pool!.withPort(port, "World");
			assert.equal(result, "[Hello World]!");
		})
	});
});
