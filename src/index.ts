import {isMainThread, Worker} from "node:worker_threads";
import {availableParallelism} from "node:os";

const makeWorkerPool = <PoolOperations extends {[operation: string]: (...args: any) => any}> (path: string, options?: {concurrency?: number, maxUtilization?: number}) => {
	const closed = new AbortController();
	const workers = Array(options?.concurrency ?? availableParallelism()).fill(null).map(() => {
		const worker = new Worker(path);
		return {worker, tasks: [] as unknown[]};
	});
	closed.signal.addEventListener("abort", () => {
		workers.forEach(({worker}) => {
			worker.postMessage({close: true});
		});
	});

	const withResolvers = <T> () => {
		let resolve: (val: T | PromiseLike<T>) => void, reject: (reason: any) => void;
		const promise = new Promise<T>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		return {promise, resolve: resolve!, reject: reject!};
	}

	const pending = [] as Array<{task: (worker: Worker) => unknown, resolve: (result: any) => any, reject: (reason: any) => any}>;
	const runTask = async (workerObj: typeof workers[number], fn: typeof pending[number]["task"], resolve: (result: any) => void, reject: (reason: any) => void) => {
		const task = Symbol();
		workerObj.tasks.push(task);

		await Promise.resolve(fn(workerObj.worker)).then(resolve, reject).catch(() => {});

		workerObj.tasks.splice(workerObj.tasks.indexOf(task), 1);
		if(pending.length > 0) {
			const nextTask = pending.pop()!;
			await runTask(workerObj, nextTask.task, nextTask.resolve, nextTask.reject);
		}
	}
	const abortQueue = new Map() as Map<symbol, () => unknown>;
	closed.signal.addEventListener("abort", () => {
		abortQueue.forEach((fn) => fn());
	});
	const postTask = async <T> (fn: (worker: Worker) => T) => {
		if (closed.signal.aborted) {
			return Promise.reject(closed.signal.reason);
		}else {
			// from ts-essentials
			type AsyncOrSync <T> = T | PromiseLike<T>;
			type AsyncOrSyncType<AsyncOrSyncType> = AsyncOrSyncType extends AsyncOrSync<infer Type> ? Type : never;

			const {promise, resolve, reject} = withResolvers<AsyncOrSyncType<ReturnType<typeof fn>>>();
			const abortSymbol = Symbol();
			abortQueue.set(abortSymbol, () => reject(closed.signal.reason));
			promise.catch(() => {}).then(() => abortQueue.delete(abortSymbol));
			const availableWorker = workers.filter(({tasks}) => tasks.length < (options?.maxUtilization ?? 1)).sort((a, b) => a.tasks.length - b.tasks.length)[0];
			if (availableWorker) {
				runTask(availableWorker, fn, resolve, reject);
			}else {
				pending.push({task: fn, resolve, reject});
			}
			return promise;
		}
	}
	return {
		task: <T extends keyof PoolOperations> (operation: T) => async (args: Parameters<PoolOperations[T]>, transferList: Transferable[]): Promise<Awaited<ReturnType<PoolOperations[T]>>> => {
			return postTask((worker) => {
				return new Promise<Awaited<ReturnType<PoolOperations[T]>>>((res, rej) => {
					const channel = new MessageChannel(); 

					channel.port1.onmessage = ({data}) => {
						channel.port1.close();
						if (data.error) {
							rej(data.error);
						}else {
							res(data.result);
						}
					};
					worker.postMessage({operation, args, port: channel.port2}, [channel.port2 as any, ...(transferList ?? [])]);
				});
			});
		},
		close: () => {
			return Promise.all([
				...workers.map(({worker}) => {
					return new Promise((res) => {
						worker.addListener("exit", (code) => {
							res(code);
						});
					});
				}),
				(async () => {
					closed.abort();
				})(),
			]);
		}
	};
}

export const withWorkerThreads = <PoolOperations extends {[operation: string]: (...args: any) => any}> (
	taskCaller: {[Property in keyof PoolOperations]: (task: (args: Parameters<PoolOperations[Property]>, transferList?: Transferable[]) => ReturnType<PoolOperations[Property]>) => (...args: Parameters<PoolOperations[Property]>) => ReturnType<PoolOperations[Property]>}
) => (
	...options: Parameters<typeof makeWorkerPool>
) => async <T> (fn: (pool?: PoolOperations) => T): Promise<Awaited<T>> => {
		if (isMainThread) {
		const workerpool = makeWorkerPool<PoolOperations>(...options);
		try {
			const poolOps = Object.fromEntries(Object.entries(taskCaller).map(([k, v]) => [k, (...args: any[]) => {
				return v(workerpool.task(k))(...args);
			}])) as any;
			return await fn(poolOps);
		}finally {
			await workerpool.close();
		}
	}else {
		return await fn(undefined);
	}
}
