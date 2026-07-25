from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from app.config import get_settings
from app.ratelimit import limiter


class _CredentialCors(BaseHTTPMiddleware):
    """Echo back the requesting origin so credentialed CORS works."""

    def __init__(self, app: ASGIApp):
        super().__init__(app)

    async def dispatch(self, request: Request, call_next):
        origin = request.headers.get("origin")
        if request.method == "OPTIONS":
            response = JSONResponse(content="ok")
            response.status_code = 200
        else:
            response = await call_next(request)
        if origin:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Methods"] = "*"
            response.headers["Access-Control-Allow-Headers"] = "*"
        return response


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="polaris-backend", version="0.1.0")
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    app.add_middleware(_CredentialCors)

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

    @app.exception_handler(Exception)
    async def _internal(req: Request, exc: Exception):
        return JSONResponse(status_code=500, content={"detail": str(exc)})

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=3000, reload=True)
