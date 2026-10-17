import React, { useState, useMemo } from 'react';
import { CopyIcon, CheckCircleIcon } from './icons';

interface ResponseViewerProps {
  responseBody: string | null | undefined;
  contentType?: string | null;
  statusCode?: number | null;
  maxInitialChars?: number;
  className?: string;
}

interface ParsedContent {
  type: 'json' | 'html' | 'text';
  raw: string;
  formatted: string;
  parsedObject: any | null;
  sizeBytes: number;
}

/**
 * Safely unwraps serialized/escaped content (e.g. JSON strings inside strings)
 * and determines if it is JSON, HTML, or plain text.
 */
function parseAndUnwrapContent(rawInput: string | null | undefined, hintContentType?: string | null): ParsedContent {
  if (rawInput == null || rawInput === '') {
    return {
      type: 'text',
      raw: '',
      formatted: '',
      parsedObject: null,
      sizeBytes: 0,
    };
  }

  const raw = String(rawInput);
  const sizeBytes = new Blob([raw]).size;
  const isHtmlHint = hintContentType?.toLowerCase().includes('html');
  const isJsonHint = hintContentType?.toLowerCase().includes('json');

  // Attempt multi-level unescaping if it's double-serialized
  let current: any = raw.trim();
  let iterations = 0;

  while (typeof current === 'string' && iterations < 3) {
    const trimmed = current.trim();
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 2)
    ) {
      try {
        const next = JSON.parse(trimmed);
        current = next;
        iterations++;
      } catch {
        break;
      }
    } else {
      break;
    }
  }

  // If current is an object or array (or parsed into one)
  if (typeof current === 'object' && current !== null) {
    try {
      const formatted = JSON.stringify(current, null, 2);
      return {
        type: 'json',
        raw,
        formatted,
        parsedObject: current,
        sizeBytes,
      };
    } catch {
      // Fallback
    }
  }

  // If current is still a string:
  if (typeof current === 'string') {
    const trimmed = current.trim();

    // Check if it's HTML
    const looksLikeHtml =
      isHtmlHint ||
      /^<!DOCTYPE\s+html/i.test(trimmed) ||
      /^<html[\s>]/i.test(trimmed) ||
      (trimmed.startsWith('<') && trimmed.endsWith('>') &&
        (trimmed.includes('</div>') || trimmed.includes('</p>') || trimmed.includes('</body>') || trimmed.includes('</span>') || trimmed.includes('</h1>')));

    if (looksLikeHtml) {
      return {
        type: 'html',
        raw,
        formatted: formatHtml(trimmed),
        parsedObject: null,
        sizeBytes,
      };
    }

    // Try parsing as JSON one more time if hint or structure suggests it
    if (isJsonHint || (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(trimmed);
        return {
          type: 'json',
          raw,
          formatted: JSON.stringify(parsed, null, 2),
          parsedObject: parsed,
          sizeBytes,
        };
      } catch {
        // Not valid JSON
      }
    }

    return {
      type: 'text',
      raw,
      formatted: current,
      parsedObject: null,
      sizeBytes,
    };
  }

  // Primitives like numbers or booleans
  return {
    type: 'json',
    raw,
    formatted: JSON.stringify(current, null, 2),
    parsedObject: current,
    sizeBytes,
  };
}

/**
 * Basic HTML tag indentation for readability without external parsers.
 */
function formatHtml(html: string): string {
  // If already multi-line, clean up unescaped \n and return
  if (html.includes('\n')) {
    return html.replace(/\\n/g, '\n').replace(/\\t/g, '  ').replace(/\\"/g, '"');
  }

  let formatted = '';
  let indent = 0;
  const tab = '  ';

  // Normalize unescaped strings
  const cleaned = html
    .replace(/\\n/g, '')
    .replace(/\\"/g, '"')
    .replace(/>\s*</g, '><');

  const parts = cleaned.split(/(<[^>]+>)/g).filter(Boolean);

  for (const part of parts) {
    if (part.startsWith('</')) {
      indent = Math.max(0, indent - 1);
      formatted += `${tab.repeat(indent)}${part}\n`;
    } else if (part.startsWith('<') && !part.endsWith('/>') && !part.startsWith('<!') && !/^<(img|hr|br|input|meta|link)/i.test(part)) {
      formatted += `${tab.repeat(indent)}${part}\n`;
      indent++;
    } else if (part.startsWith('<')) {
      formatted += `${tab.repeat(indent)}${part}\n`;
    } else {
      const text = part.trim();
      if (text) {
        formatted += `${tab.repeat(indent)}${text}\n`;
      }
    }
  }

  return formatted.trim() || html;
}

/**
 * Tokenize formatted JSON string into syntax-highlighted React nodes.
 */
function renderJsonSyntaxHighlight(jsonStr: string): React.ReactNode[] {
  // Matches JSON tokens: strings, keys, numbers, booleans, null
  const regex = /("(?:\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?|[{}\[\],:])/g;

  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(jsonStr)) !== null) {
    const text = match[0];
    const matchIndex = match.index;

    // Add preceding whitespace / newlines
    if (matchIndex > lastIndex) {
      elements.push(jsonStr.substring(lastIndex, matchIndex));
    }

    if (match[2]) {
      // Key: "key":
      const keyName = text.slice(0, text.indexOf(':')).trim();
      elements.push(
        <span key={matchIndex} className="text-sky-400 font-semibold">
          {keyName}
        </span>
      );
      elements.push(
        <span key={`${matchIndex}-colon`} className="text-slate-400 font-normal">
          :&nbsp;
        </span>
      );
    } else if (text.startsWith('"')) {
      // String value
      elements.push(
        <span key={matchIndex} className="text-emerald-400 break-all">
          {text}
        </span>
      );
    } else if (/true|false/.test(text)) {
      // Boolean
      elements.push(
        <span key={matchIndex} className="text-purple-400 font-semibold">
          {text}
        </span>
      );
    } else if (text === 'null') {
      // Null
      elements.push(
        <span key={matchIndex} className="text-rose-400 font-semibold italic">
          null
        </span>
      );
    } else if (/^-?\d/.test(text)) {
      // Number
      elements.push(
        <span key={matchIndex} className="text-amber-400">
          {text}
        </span>
      );
    } else {
      // Punctuation: { } [ ] ,
      elements.push(
        <span key={matchIndex} className="text-slate-400">
          {text}
        </span>
      );
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < jsonStr.length) {
    elements.push(jsonStr.substring(lastIndex));
  }

  return elements;
}

export const ResponseViewer: React.FC<ResponseViewerProps> = ({
  responseBody,
  contentType,
  maxInitialChars = 50_000,
  className = '',
}) => {
  const [viewMode, setViewMode] = useState<'pretty' | 'raw'>('pretty');
  const [htmlSubTab, setHtmlSubTab] = useState<'code' | 'preview'>('code');
  const [copied, setCopied] = useState<boolean>(false);
  const [showFull, setShowFull] = useState<boolean>(false);

  // Parse and unnest response
  const parsed = useMemo(() => {
    return parseAndUnwrapContent(responseBody, contentType);
  }, [responseBody, contentType]);

  if (!responseBody && !parsed.raw) {
    return (
      <div className="p-8 text-center text-xs text-slate-400 bg-slate-900/50 rounded-xl border border-dashed border-slate-800">
        Empty response body received from server.
      </div>
    );
  }

  const activeText = viewMode === 'pretty' ? parsed.formatted : parsed.raw;
  const isTruncated = !showFull && activeText.length > maxInitialChars;
  const displayedText = isTruncated ? activeText.slice(0, maxInitialChars) : activeText;

  const handleCopy = () => {
    // Copy the entire, untruncated content
    navigator.clipboard.writeText(activeText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const ext = parsed.type === 'json' ? 'json' : parsed.type === 'html' ? 'html' : 'txt';
    const mime = parsed.type === 'json' ? 'application/json' : parsed.type === 'html' ? 'text/html' : 'text/plain';
    const blob = new Blob([activeText], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `response_${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className={`flex flex-col rounded-xl overflow-hidden border border-slate-800 bg-slate-950 text-slate-100 ${className}`}>
      {/* Response Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-slate-900 border-b border-slate-800 text-xs">
        <div className="flex items-center gap-2">
          {/* Format Badge */}
          <span className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold uppercase tracking-wider ${
            parsed.type === 'json'
              ? 'bg-blue-950 text-blue-300 border border-blue-800'
              : parsed.type === 'html'
              ? 'bg-amber-950 text-amber-300 border border-amber-800'
              : 'bg-slate-800 text-slate-300 border border-slate-700'
          }`}>
            {parsed.type}
          </span>

          <span className="text-slate-400 text-[11px]">
            {formatBytes(parsed.sizeBytes)}
          </span>

          {/* HTML sub-tabs */}
          {parsed.type === 'html' && viewMode === 'pretty' && (
            <div className="flex items-center bg-slate-800/80 p-0.5 rounded-md border border-slate-700 ml-2">
              <button
                type="button"
                onClick={() => setHtmlSubTab('code')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  htmlSubTab === 'code' ? 'bg-slate-700 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                HTML Code
              </button>
              <button
                type="button"
                onClick={() => setHtmlSubTab('preview')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  htmlSubTab === 'preview' ? 'bg-slate-700 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Rendered Preview
              </button>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5">
          {/* Pretty vs Raw Toggle */}
          <div className="flex items-center bg-slate-800/80 p-0.5 rounded-md border border-slate-700">
            <button
              type="button"
              onClick={() => setViewMode('pretty')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                viewMode === 'pretty' ? 'bg-slate-700 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Pretty
            </button>
            <button
              type="button"
              onClick={() => setViewMode('raw')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                viewMode === 'raw' ? 'bg-slate-700 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Raw
            </button>
          </div>

          {/* Download button */}
          <button
            type="button"
            onClick={handleDownload}
            className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 border border-slate-700 transition-colors"
            title="Download full response"
          >
            Download
          </button>

          {/* Copy button */}
          <button
            type="button"
            onClick={handleCopy}
            className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 border border-slate-700 flex items-center gap-1 transition-colors"
            title="Copy full response to clipboard"
          >
            {copied ? (
              <>
                <CheckCircleIcon size={12} className="text-emerald-400" />
                <span className="text-emerald-400">Copied!</span>
              </>
            ) : (
              <>
                <CopyIcon size={12} />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Truncation warning if large */}
      {isTruncated && (
        <div className="px-4 py-2 bg-amber-950/80 border-b border-amber-800/60 text-amber-200 text-xs flex items-center justify-between">
          <span>
            Large payload: displaying first {(maxInitialChars / 1000).toFixed(0)} KB of {(activeText.length / 1000).toFixed(1)} KB to avoid freezing the UI.
          </span>
          <button
            type="button"
            onClick={() => setShowFull(true)}
            className="px-2 py-0.5 rounded bg-amber-800 hover:bg-amber-700 text-white text-[11px] font-semibold transition-colors"
          >
            Show full ({activeText.length.toLocaleString()} chars)
          </button>
        </div>
      )}

      {/* Content Area */}
      <div className="relative">
        {parsed.type === 'html' && viewMode === 'pretty' && htmlSubTab === 'preview' ? (
          <div className="bg-white rounded-b-xl overflow-hidden">
            <iframe
              title="HTML Response Preview"
              srcDoc={displayedText}
              sandbox=""
              className="w-full h-80 border-none bg-white"
            />
          </div>
        ) : (
          <pre className="p-4 font-mono text-xs leading-relaxed overflow-x-auto max-h-[420px] select-text selection:bg-blue-600/40 text-slate-200 whitespace-pre-wrap break-all">
            {viewMode === 'pretty' && parsed.type === 'json' ? (
              <code>{renderJsonSyntaxHighlight(displayedText)}</code>
            ) : (
              <code>{displayedText}</code>
            )}
          </pre>
        )}
      </div>
    </div>
  );
};
