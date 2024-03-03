import {describe, it, mock} from "node:test";
import { strict as assert } from "node:assert";
import crypto from "node:crypto";
import path from "node:path";
import url from "node:url";
import util from "node:util";
import {hello, div, helloBuffer, withPort, externalControlled} from "./worker.js";
import {withWorkerThreads} from "../index.js";
import {BroadcastChannel} from "node:worker_threads";
import {setTimeout} from "node:timers/promises";

export type Pool = {
	hello: typeof hello,
	div: typeof div,
	helloBuffer: typeof helloBuffer,
	withPort: typeof withPort,
	externalControlled: typeof externalControlled,
};

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

process.on('unhandledRejection', (error, p) => {
	console.log("UNHANDLED REJECTION")
	console.log(util.inspect(error))
	console.log("unhandled", util.inspect(p))
});

const withResolvers = <T> () => {
	let resolve: (val: Promise<T> | T) => void, reject: (reason: any) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return {promise, resolve: resolve!, reject: reject!};
}

describe("basic", () => {
	it("allows calling the worker thread pool with simple data", async () => {
		await withWorkerThreads<Pool>({
			hello: (task) => (...args) => task(args),
			div: (task) => (...args) => task(args),
			helloBuffer: (task) => (...args) => task(args),
			withPort: (task) => (port, ...rest) => task([port, ...rest], [port]),
			externalControlled: (task) => (...args) => task(args),
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
			externalControlled: (task) => (...args) => task(args),
		})(path.join(__dirname, "worker.js"), {concurrency: 1})(async (pool) => {
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
			externalControlled: (task) => (...args) => task(args),
		})(path.join(__dirname, "worker.js"), {concurrency: 1})(async (pool) => {
			await assert.rejects(pool!.div(4,0));
		})
	});
	it("handles transferred results", async () => {
		await withWorkerThreads<Pool>({
			hello: (task) => (...args) => task(args),
			div: (task) => (...args) => task(args),
			helloBuffer: (task) => (...args) => task(args),
			withPort: (task) => (port, ...rest) => task([port, ...rest], [port]),
			externalControlled: (task) => (...args) => task(args),
		})(path.join(__dirname, "worker.js"), {concurrency: 1})(async (pool) => {
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
			externalControlled: (task) => (...args) => task(args),
		})(path.join(__dirname, "worker.js"), {concurrency: 1})(async (pool) => {
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

describe("timing", () => {
	it("executes only one task per thread", async () => {
		await withWorkerThreads<Pool>({
			hello: (task) => (...args) => task(args),
			div: (task) => (...args) => task(args),
			helloBuffer: (task) => (...args) => task(args),
			withPort: (task) => (port, ...rest) => task([port, ...rest], [port]),
			externalControlled: (task) => (...args) => task(args),
		})(path.join(__dirname, "worker.js"), {concurrency: 1})(async (pool) => {
			const bcName = crypto.randomUUID();
			const bc = new BroadcastChannel(bcName);
			const resultProm = pool!.externalControlled(bcName);
			try {
				await new Promise((res) => {
					bc.onmessage = (msg: any) => {
						if (msg.data.type === "started") {
							res(msg.data);
						}
					}
				});
				const bcName2 = crypto.randomUUID();
				const bc2 = new BroadcastChannel(bcName2);
				const resultProm2 = pool!.externalControlled(bcName2);
				try {
					await Promise.race([
						new Promise((_res, rej) => {
							bc2.onmessage = (msg: any) => {
								if (msg.data.type === "started") {
									rej(msg.data);
								}
							}
						}),
						setTimeout(200),
					]);
					await Promise.all([
						bc.postMessage({type: "resolve", result: "res1"}),
						new Promise((res) => {
							bc2.onmessage = (msg: any) => {
								if (msg.data.type === "started") {
									res(msg.data);
								}
							}
						})
					]);
					assert.equal(await resultProm, "res1");
					await Promise.all([
						bc2.postMessage({type: "resolve", result: "res2"}),
						resultProm2,
					]);
					assert.equal(await resultProm2, "res2");
				}finally {
					bc2.postMessage({type: "close"});
					bc2.close();
				}
			}finally {
				bc.postMessage({type: "close"});
				bc.close();
			}
		})
	});
	it("exit waits for background processing", async () => {
		const {promise: finishedPromise, resolve: resolveFinished} = withResolvers();
		const bcName = crypto.randomUUID();
		const bc = new BroadcastChannel(bcName);

		const returnedProm = withWorkerThreads<Pool>({
			hello: (task) => (...args) => task(args),
			div: (task) => (...args) => task(args),
			helloBuffer: (task) => (...args) => task(args),
			withPort: (task) => (port, ...rest) => task([port, ...rest], [port]),
			externalControlled: (task) => (...args) => task(args),
		})(path.join(__dirname, "worker.js"), {concurrency: 1})(async (pool) => {
			const resultProm = pool!.externalControlled(bcName);
			await new Promise((res) => {
				bc.onmessage = (msg: any) => {
					if (msg.data.type === "started") {
						res(msg.data);
					}
				}
			});
			bc.postMessage({type: "resolve", result: "res1"});
			resultProm.then(resolveFinished);
			await resultProm;
		})
		await finishedPromise;
		await Promise.race([
			setTimeout(200),
			returnedProm.then(() => {throw new Error("Should have been pending")}),
		]);
		bc.postMessage({type: "close"});
		bc.close();
		await returnedProm;
	});
	it("task is rejected when the argument function returns", async () => {
		const {promise: taskFailedPromise, resolve: resolveTaskFailed} = withResolvers();
		const bcName = crypto.randomUUID();
		const bc = new BroadcastChannel(bcName);

		await withWorkerThreads<Pool>({
			hello: (task) => (...args) => task(args),
			div: (task) => (...args) => task(args),
			helloBuffer: (task) => (...args) => task(args),
			withPort: (task) => (port, ...rest) => task([port, ...rest], [port]),
			externalControlled: (task) => (...args) => task(args),
		})(path.join(__dirname, "worker.js"), {concurrency: 1})(async (pool) => {
			const resultProm = pool!.externalControlled(bcName);
			await new Promise((res) => {
				bc.onmessage = (msg: any) => {
					if (msg.data.type === "started") {
						res(msg.data);
					}
				}
			});
			resultProm.catch((e) => resolveTaskFailed(e));
			bc.postMessage({type: "close"});
		})
		await taskFailedPromise;
		bc.close();
	});
	it("new tasks are rejected after the argument function returned", async () => {
		let savedPool: any;
		await withWorkerThreads<Pool>({
			hello: (task) => (...args) => task(args),
			div: (task) => (...args) => task(args),
			helloBuffer: (task) => (...args) => task(args),
			withPort: (task) => (port, ...rest) => task([port, ...rest], [port]),
			externalControlled: (task) => (...args) => task(args),
		})(path.join(__dirname, "worker.js"), {concurrency: 1})(async (pool) => {
			savedPool = pool;
		})
		await new Promise((res, rej) => {
			savedPool!.hello("World").then(
				() => rej("Should have failed"),
				(e: any) => res(e),
			);
		})
	});
})
