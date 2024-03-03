import {isMainThread, parentPort, BroadcastChannel, threadId} from "node:worker_threads";
import {Pool} from "./index.test.js";

export const hello = async (name: string): Promise<string> => {
	return "Hello " + name + "!";
}

export const div = async (a: number, b: number): Promise<number> => {
	if (b === 0) {
		throw new Error("Div by zero!");
	}else {
		return a / b;
	}
}

const bufferToArrayBuffer = (buffer: Buffer) => {
	// force copy the underlying arraybuffer as it can be cached in the with-file-cache memoryCache
	return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

export const helloBuffer = async (name: string): Promise<ArrayBuffer> => {
	return bufferToArrayBuffer(Buffer.from("Hello " + name + "!", "utf8"));
}

export const withPort = async (port: MessagePort, param: string): Promise<string> => {
	const callPort = (param: string) => new Promise<string>((res, rej) => {
		const channel = new MessageChannel(); 
		channel.port1.onmessage = ({data}) => {
			channel.port1.close();
			if (data.error) {
				rej(data.error);
			}else {
				res(data.data);
			}
		};
		port.postMessage({type: "call", data: param}, [channel.port2]);
	});

	const processed = await callPort("Hello " + param);
	return processed + "!";
}

export const externalControlled = async (channelName: string): Promise<string> => {
	const withResolvers = <T> () => {
		let resolve: (val: Promise<T> | T) => void, reject: (reason: any) => void;
		const promise = new Promise<T>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		return {promise, resolve: resolve!, reject: reject!};
	}
	const {promise, resolve, reject} = withResolvers<string>();

	const bc = new BroadcastChannel(channelName);
	bc.onmessage = (msg: any) => {
		if (msg.data.type === "close") {
			bc.close();
		}else if (msg.data.type === "resolve") {
			resolve(msg.data.result);
		}else if (msg.data.type === "reject") {
			reject(msg.data.reason);
		}
	};
	bc.postMessage({type: "started", threadId});
	return promise;
}

if (!isMainThread) {
	parentPort!.on("message", async <T extends keyof Pool> ({close, operation, args, port}: {close: true, operation: undefined, args: undefined, port: undefined} | {close: undefined, operation: T, args: Parameters<Pool[T]>, port: MessagePort}) => {
		try {
			if (close) {
				parentPort!.close();
			}else {
				switch(operation) {
					case "hello": {
						const res = await hello(...args as Parameters<Pool["hello"]>);
						port.postMessage({result: res});
						break;
					}
					case "div": {
						const res = await div(...args as Parameters<Pool["div"]>);
						port.postMessage({result: res});
						break;
					}
					case "helloBuffer": {
						const res = await helloBuffer(...args as Parameters<Pool["helloBuffer"]>);
						port.postMessage({result: res}, [res]);
						break;
					}
					case "withPort": {
						const res = await withPort(...args as Parameters<Pool["withPort"]>);
						port.postMessage({result: res}, []);
						break;
					}
					case "externalControlled": {
						const res = await externalControlled(...args as Parameters<Pool["externalControlled"]>);
						port.postMessage({result: res}, []);
						break;
					}
					default:
						throw new Error("Unknown operation: " + operation)
				}
			}
		}catch(e) {
			port?.postMessage({error: e});
		}
	});
}
