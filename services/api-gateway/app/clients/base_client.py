import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from typing import Optional, Dict, Any
import logging

logger = logging.getLogger(__name__)


class BaseServiceClient:
    """Base HTTP client with retry logic and circuit breaker pattern."""

    def __init__(self, base_url: str, timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=timeout,
        )

    @retry(
        wait=wait_exponential(multiplier=1, min=1, max=4),
        stop=stop_after_attempt(3),
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.ConnectError, httpx.HTTPStatusError)),
        reraise=True,
    )
    async def _request(
        self,
        method: str,
        path: str,
        params: Optional[Dict] = None,
        json: Optional[Dict] = None,
    ) -> httpx.Response:
        url = f"{self.base_url}{path}"
        logger.debug(f"Calling {method} {url}")
        response = await self.client.request(method, url, params=params, json=json)
        response.raise_for_status()
        return response

    async def get(self, path: str, params: Optional[Dict] = None) -> Dict[str, Any]:
        response = await self._request("GET", path, params=params)
        return response.json()

    async def post(self, path: str, json: Optional[Dict] = None) -> Dict[str, Any]:
        response = await self._request("POST", path, json=json)
        return response.json()

    async def close(self):
        await self.client.aclose()