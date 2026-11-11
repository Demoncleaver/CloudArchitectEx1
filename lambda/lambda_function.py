import base64
import json
import os
import time

import boto3
from boto3.dynamodb.conditions import Key
from openai import OpenAI

MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
HISTORY_LIMIT = 6
CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
table = boto3.resource("dynamodb").Table(os.environ.get("TABLE_NAME", "chat-history"))


def lambda_handler(event, context):
    method = (
        event.get("requestContext", {}).get("http", {}).get("method")
        or event.get("httpMethod")
        or "POST"
    ).upper()

    if method == "OPTIONS":
        return build_response(200, {"message": "OK"})
    if method != "POST":
        return build_response(405, {"error": f"Method {method} not allowed. Use POST."})

    try:
        payload = parse_body(event)
    except ValueError:
        return build_response(400, {"error": "Request body must be a valid JSON object."})

    user_prompt = str(payload.get("user_prompt", "")).strip()
    if not user_prompt:
        return build_response(400, {"error": "Missing required field: user_prompt"})
    user_id = str(payload.get("user_id") or "anonymous")

    try:
        history = table.query(
            KeyConditionExpression=Key("user_id").eq(user_id),
            ScanIndexForward=False,
            Limit=HISTORY_LIMIT,
        )["Items"]
        messages = [{"role": item["role"], "content": item["content"]} for item in reversed(history)]
        messages.append({"role": "user", "content": user_prompt})

        user_timestamp = int(time.time() * 1000)
        started = time.perf_counter()
        response = client.responses.create(model=MODEL, input=messages)
        openai_response_time_ms = round((time.perf_counter() - started) * 1000)
        ai_reply = response.output_text

        assistant_timestamp = max(int(time.time() * 1000), user_timestamp + 1)
        with table.batch_writer() as batch:
            batch.put_item(Item={
                "user_id": user_id,
                "timestamp": user_timestamp,
                "role": "user",
                "content": user_prompt,
            })
            batch.put_item(Item={
                "user_id": user_id,
                "timestamp": assistant_timestamp,
                "role": "assistant",
                "content": ai_reply,
            })
    except Exception as error:
        return build_response(500, {"error": str(error)})

    return build_response(200, {
        "ai_reply": ai_reply,
        "openai_response_time_ms": openai_response_time_ms,
    })


def parse_body(event):
    body = event.get("body") or "{}"
    if isinstance(body, dict):
        return body
    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode("utf-8")
    payload = json.loads(body)
    if not isinstance(payload, dict):
        raise ValueError("Body is not a JSON object")
    return payload


def build_response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json", **CORS_HEADERS},
        "body": json.dumps(body),
    }
