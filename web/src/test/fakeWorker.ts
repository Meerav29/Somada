import type { WorkerLike, WorkerMessage, WorkerRequest } from '../lib/health/worker-protocol'

export class FakeWorker implements WorkerLike {
  posted: WorkerRequest[] = []
  terminated = false
  onmessage: WorkerLike['onmessage'] = null
  onerror: WorkerLike['onerror'] = null
  onmessageerror: WorkerLike['onmessageerror'] = null

  postMessage(message: WorkerRequest) {
    this.posted.push(message)
  }

  terminate() {
    this.terminated = true
  }

  emit(message: WorkerMessage) {
    this.onmessage?.({ data: message } as MessageEvent<WorkerMessage>)
  }
}
