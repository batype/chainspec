const token =
  /(\/\/[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b(?:import|from|export|type|interface|const|let|return|async|await|function|new|throw|if|else|true|false|undefined|null|string|number|unknown|boolean)\b|\b\d+\b)/g;
export default function Code({
  text,
  limit = 220,
}: {
  text: string;
  limit?: number;
}) {
  const lines = text.split("\n"),
    shown = lines.slice(0, limit);
  return (
    <>
      <pre className="code" tabIndex={0} aria-label="代码预览">
        <code>
          {shown.map((line, i) => (
            <span className="code-line" key={i}>
              <span className="line-no" aria-hidden="true">
                {i + 1}
              </span>
              <span>
                {line.split(token).map((part, j) => (
                  <span
                    key={j}
                    className={
                      /^['"]/.test(part)
                        ? "str"
                        : part.startsWith("//")
                          ? "comment"
                          : /^(import|from|export|type|interface|const|let|return|async|await|function|new|throw|if|else|true|false|undefined|null|string|number|unknown|boolean)$/.test(
                                part,
                              )
                            ? "kw"
                            : /^\d+$/.test(part)
                              ? "num"
                              : undefined
                    }
                  >
                    {part}
                  </span>
                ))}
              </span>
            </span>
          ))}
        </code>
      </pre>
      {lines.length > limit && (
        <p className="preview-limit">
          预览前 {limit} / {lines.length} 行；下载包含完整文件。
        </p>
      )}
    </>
  );
}
