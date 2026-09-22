// Cloud Logging が構造化ログとして解釈できる JSON 1 行形式で出力する
type Severity = "DEBUG" | "INFO" | "WARNING" | "ERROR";

function write(
  severity: Severity,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({
    severity,
    message,
    ...fields,
    time: new Date().toISOString(),
  });
  if (severity === "ERROR" || severity === "WARNING") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) =>
    write("DEBUG", message, fields),
  info: (message: string, fields?: Record<string, unknown>) =>
    write("INFO", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) =>
    write("WARNING", message, fields),
  error: (message: string, fields?: Record<string, unknown>) =>
    write("ERROR", message, fields),
};
