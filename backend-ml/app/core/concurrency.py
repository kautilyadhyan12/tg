"""Bridge synchronous generators (e.g. Groq streaming) into async iterators.

Iterating a sync generator directly inside an async endpoint blocks the
entire event loop between chunks — while one user's LLM response streams,
every other user (including live pose WebSocket frames) freezes. This
helper runs the generator in a worker thread and hands chunks back through
an asyncio queue, keeping the loop free.
"""
import asyncio
import threading
from typing import AsyncIterator, Iterator

_SENTINEL = object()


async def iterate_in_thread(sync_iter: Iterator, max_buffer: int = 256) -> AsyncIterator:
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue(maxsize=max_buffer)

    def _producer():
        try:
            for item in sync_iter:
                fut = asyncio.run_coroutine_threadsafe(queue.put(item), loop)
                fut.result()  # backpressure: wait if consumer is slow
        except BaseException as e:  # propagate errors to the consumer
            asyncio.run_coroutine_threadsafe(queue.put(e), loop).result()
        finally:
            asyncio.run_coroutine_threadsafe(queue.put(_SENTINEL), loop).result()

    thread = threading.Thread(target=_producer, daemon=True)
    thread.start()

    while True:
        item = await queue.get()
        if item is _SENTINEL:
            break
        if isinstance(item, BaseException):
            raise item
        yield item
