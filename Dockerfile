FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 APP_DATABASE=/data/workspace.sqlite3
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && groupadd --gid 10001 axiom && useradd --uid 10001 --gid 10001 --no-create-home axiom && mkdir /data && chown axiom:axiom /data
COPY --chown=axiom:axiom app ./app
USER axiom
EXPOSE 8000
CMD ["gunicorn", "app.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "4", "--timeout", "30", "--access-logfile", "-"]
