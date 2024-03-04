import {BroadcastChannel, threadId} from "node:worker_threads";
import {Pool} from "./index.test.js";
import {implementWorker} from "../index.js";

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
	// force copy the underlying arraybuffer
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

export const returnPort = async (name: string): Promise<{port: MessagePort, result: string}> => {
	const createPort = () => {
		const channel = new MessageChannel();
		channel.port2.onmessage = async ({data: msg}) => {
			channel.port2.postMessage(`Hello ${name}! [${msg}]`);
		}
		return channel.port1;
	}

	return {
		result: `[${name}]`,
		port: createPort(),
	};
}

implementWorker<Pool>({
	hello: async (...args) => hello(...args),
	div: async (...args) => div(...args),
	helloBuffer: async (...args) => {
		const res = await helloBuffer(...args);
		return {
			result: res,
			transfer: [res],
		};
	},
	withPort: async (...args) => withPort(...args),
	externalControlled: async (...args) => externalControlled(...args),
	transformedHello: async (...args) => hello(...args),
	returnPort: async (...args) => {
		const res = await returnPort(...args);
		return {
			result: res,
			transfer: [res.port],
		};
	}
});

