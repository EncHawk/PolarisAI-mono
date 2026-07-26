from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.config import get_settings
from app.logging_utils import log_request_end, log_request_start, POLARIS_LOGGER
from app.ratelimit import limiter


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="polaris-backend", version="0.1.0")
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    origins = s.cors_origins_list
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins if origins != ["*"] else [],
        allow_origin_regex=".*" if origins == ["*"] else None,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def _log_requests(request: Request, call_next):
        """Log every request with method, path, client, timing and full traceback on error."""
        t0 = log_request_start(request)
        response = None
        try:
            response = await call_next(request)
            log_request_end(request, response.status_code, t0)
            return response
        except Exception as exc:
            status = 500
            log_request_end(request, status, t0, error=exc)
            raise

    # routers
    from app.auth.routes import router as auth_router
    from app.code_routes import router as code_router
    from app.billing.routes import router as billing_router
    from app.events.routes import router as events_router
    from app.health import router as health_router
    from app.ingest.routes import router as ingest_router
    from app.list.routes import router as list_router
    from app.plan_routes import router as plan_router

    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(code_router)
    app.include_router(billing_router)
    app.include_router(ingest_router)
    app.include_router(events_router)
    app.include_router(list_router)
    app.include_router(plan_router)

    @app.exception_handler(HTTPException)
    async def _http_exception(req: Request, exc: HTTPException):
        """Pass through user-facing HTTPExceptions with their original detail."""
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    @app.exception_handler(Exception)
    async def _internal(req: Request, exc: Exception):
        """Catch-all for unexpected server errors. Never leak internal details to the client."""
        POLARIS_LOGGER.exception("Unhandled server error for %s %s", req.method, req.url)
        return JSONResponse(
            status_code=500,
            content={"detail": "Something went wrong. Please try again in a moment."},
        )

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=3000, reload=True)
