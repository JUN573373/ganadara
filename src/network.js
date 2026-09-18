// 최초 요청 + 최대 두 번 재시도. 응답 본문 읽기도 같은 시도에 포함합니다.
export async function withNetworkRetry(operation, { signal, onRetry = () => {}, timeoutMs = 30000 } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      return await operation(requestSignal);
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      const retryable = error.retryable === true || error instanceof TypeError ||
        error.name === 'TimeoutError' || timeout.aborted ||
        ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN'].includes(error.code);
      if (!retryable || attempt === 2) throw error;
      onRetry(attempt + 1);
      await new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 400 * (attempt + 1));
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      });
    }
  }
}

export function httpError(status) {
  const error = new Error('HTTP ' + status + ' 응답으로 통신에 실패했습니다.');
  error.retryable = [408, 429].includes(status) || status >= 500;
  return error;
}
