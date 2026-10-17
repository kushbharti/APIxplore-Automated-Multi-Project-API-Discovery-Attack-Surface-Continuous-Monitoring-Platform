import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import {
  CloseIcon, PlayIcon, RefreshIcon,
  AlertTriangleIcon, PlusIcon, TrashIcon
} from './icons';
import { ResponseViewer } from './ResponseViewer';

interface ParameterField {
  name: string;
  in: 'path' | 'query' | 'header';
  required: boolean;
  type: string;
  description?: string | null;
  default?: any;
  enum?: any[] | null;
}

interface BodyField {
  name: string;
  type: string;
  required: boolean;
  description?: string | null;
  default?: any;
  enum?: any[] | null;
  fields?: BodyField[];
  item_type?: string | null;
  item_fields?: BodyField[];
}

interface RequestBodySchema {
  content_type: string;
  content_types?: string[];
  required: boolean;
  fields: BodyField[];
  raw_schema?: any;
}

interface EndpointSchema {
  endpoint_id: string;
  method: string;
  url: string;
  path: string;
  path_parameters: ParameterField[];
  query_parameters: ParameterField[];
  headers: ParameterField[];
  request_body: RequestBodySchema | null;
}

interface CheckResponse {
  id: string;
  endpoint_id: string;
  checked_at: string;
  status_code: number | null;
  latency_ms: number | null;
  success: boolean;
  failure_reason: string | null;
  error_detail: string | null;
  response_body: string | null;
  response_headers: string | null;
  content_type: string | null;
  response_size_bytes: number | null;
}

interface HttpRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  endpoint: {
    id: string;
    method: string;
    url: string;
    path?: string | null;
    name?: string | null;
  };
  onSuccessCheck?: () => void;
}

interface HttpRequestFormProps {
  schema: EndpointSchema;
  endpoint: {
    id: string;
    method: string;
    url: string;
    path?: string | null;
    name?: string | null;
  };
  onClose: () => void;
  onSuccessCheck?: () => void;
}

/**
 * Builds initial values for a BodyField recursively.
 */
function buildDefaultFieldValue(field: BodyField): any {
  if (field.default !== undefined && field.default !== null) {
    return field.default;
  }
  if (field.enum && field.enum.length > 0) {
    return field.required ? field.enum[0] : '';
  }
  if (field.type === 'object' || (field.fields && field.fields.length > 0)) {
    const obj: Record<string, any> = {};
    if (field.fields) {
      for (const child of field.fields) {
        obj[child.name] = buildDefaultFieldValue(child);
      }
    }
    return obj;
  }
  if (field.type === 'array' || field.item_type || (field.item_fields && field.item_fields.length > 0)) {
    return [];
  }
  if (field.type === 'boolean') {
    return false;
  }
  if (field.type === 'integer' || field.type === 'number') {
    return '';
  }
  return '';
}

/**
 * Recursively validates required fields in body payload.
 */
function validateBodyFields(fields: BodyField[], data: any, prefix = ''): string | null {
  if (!fields || !Array.isArray(fields)) return null;

  for (const f of fields) {
    const val = data ? data[f.name] : undefined;
    const fieldPath = prefix ? `${prefix}.${f.name}` : f.name;

    if (f.required) {
      if (val === undefined || val === null || val === '') {
        return `Request body field "${fieldPath}" is required.`;
      }
      if (f.type === 'array' && Array.isArray(val) && val.length === 0) {
        return `Array field "${fieldPath}" requires at least one item.`;
      }
    }

    if (val !== undefined && val !== null && val !== '') {
      if ((f.type === 'object' || (f.fields && f.fields.length > 0)) && typeof val === 'object') {
        const nestedErr = validateBodyFields(f.fields || [], val, fieldPath);
        if (nestedErr) return nestedErr;
      }
      if ((f.type === 'array' || f.item_fields) && Array.isArray(val) && f.item_fields && f.item_fields.length > 0) {
        for (let i = 0; i < val.length; i++) {
          const itemErr = validateBodyFields(f.item_fields, val[i], `${fieldPath}[${i}]`);
          if (itemErr) return itemErr;
        }
      }
    }
  }

  return null;
}

/**
 * Recursive field renderer supporting primitives, enums, nested objects, and arrays.
 */
const BodyFieldItem: React.FC<{
  field: BodyField;
  value: any;
  onChange: (val: any) => void;
  depth?: number;
}> = ({ field, value, onChange, depth = 0 }) => {
  const isObject = field.type === 'object' || (field.fields && field.fields.length > 0);
  const isArray = field.type === 'array' || Boolean(field.item_type) || Boolean(field.item_fields && field.item_fields.length > 0);

  // 1. Nested Object Renderer
  if (isObject && field.fields && field.fields.length > 0) {
    const currentObj = typeof value === 'object' && value !== null ? value : {};
    return (
      <div className={`space-y-3 p-3.5 rounded-xl border transition-all ${
        depth === 0 ? 'bg-slate-50/80 border-slate-200' : 'bg-white border-slate-200 shadow-xs'
      }`}>
        <div className="flex items-center justify-between border-b border-slate-200 pb-2">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xs font-bold text-slate-800">{field.name}</span>
              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-medium bg-purple-50 text-purple-700 border border-purple-200">
                object
              </span>
              {field.required && (
                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                  Required
                </span>
              )}
            </div>
            {field.description && (
              <p className="text-[11px] text-slate-500 mt-0.5">{field.description}</p>
            )}
          </div>
        </div>

        <div className="space-y-3 pl-1 pt-1">
          {field.fields.map((child) => (
            <BodyFieldItem
              key={child.name}
              field={child}
              value={currentObj[child.name]}
              onChange={(newChildVal) => {
                onChange({ ...currentObj, [child.name]: newChildVal });
              }}
              depth={depth + 1}
            />
          ))}
        </div>
      </div>
    );
  }

  // 2. Dynamic Array Renderer
  if (isArray) {
    const currentList: any[] = Array.isArray(value) ? value : [];
    const itemType = field.item_type || 'string';
    const hasObjectItems = Boolean(field.item_fields && field.item_fields.length > 0);

    const handleAddItem = () => {
      if (hasObjectItems && field.item_fields) {
        const newObj: Record<string, any> = {};
        for (const child of field.item_fields) {
          newObj[child.name] = buildDefaultFieldValue(child);
        }
        onChange([...currentList, newObj]);
      } else if (itemType === 'integer' || itemType === 'number') {
        onChange([...currentList, 0]);
      } else if (itemType === 'boolean') {
        onChange([...currentList, false]);
      } else {
        onChange([...currentList, '']);
      }
    };

    const handleRemoveItem = (index: number) => {
      onChange(currentList.filter((_, i) => i !== index));
    };

    const handleUpdateItem = (index: number, newVal: any) => {
      const copy = [...currentList];
      copy[index] = newVal;
      onChange(copy);
    };

    return (
      <div className={`space-y-3 p-3.5 rounded-xl border transition-all ${
        depth === 0 ? 'bg-slate-50/80 border-slate-200' : 'bg-white border-slate-200 shadow-xs'
      }`}>
        <div className="flex items-center justify-between border-b border-slate-200 pb-2">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xs font-bold text-slate-800">{field.name}</span>
              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                array[{itemType}]
              </span>
              {field.required && (
                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                  Required
                </span>
              )}
            </div>
            {field.description && (
              <p className="text-[11px] text-slate-500 mt-0.5">{field.description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={handleAddItem}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-colors"
          >
            <PlusIcon size={12} />
            <span>Add Item</span>
          </button>
        </div>

        {currentList.length === 0 ? (
          <div className="p-3 text-center text-xs text-slate-400 bg-white rounded-lg border border-dashed border-slate-200">
            No items in list. Click "Add Item" to add an entry.
          </div>
        ) : (
          <div className="space-y-2.5">
            {currentList.map((item, idx) => (
              <div key={idx} className="flex items-start gap-2 bg-white p-2.5 rounded-lg border border-slate-200">
                <span className="text-[10px] font-mono font-bold text-slate-400 mt-2 px-1">
                  #{idx + 1}
                </span>

                <div className="flex-1">
                  {hasObjectItems && field.item_fields ? (
                    <div className="space-y-2 pt-1">
                      {field.item_fields.map((subField) => (
                        <BodyFieldItem
                          key={subField.name}
                          field={subField}
                          value={item ? item[subField.name] : undefined}
                          onChange={(subVal) => {
                            const updatedObj = { ...(item || {}), [subField.name]: subVal };
                            handleUpdateItem(idx, updatedObj);
                          }}
                          depth={depth + 1}
                        />
                      ))}
                    </div>
                  ) : itemType === 'boolean' ? (
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleUpdateItem(idx, true)}
                        className={`px-3 py-1 rounded-md text-xs font-medium border transition-colors ${
                          item === true ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 text-slate-600 border-slate-200'
                        }`}
                      >
                        true
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUpdateItem(idx, false)}
                        className={`px-3 py-1 rounded-md text-xs font-medium border transition-colors ${
                          item === false ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 text-slate-600 border-slate-200'
                        }`}
                      >
                        false
                      </button>
                    </div>
                  ) : itemType === 'integer' || itemType === 'number' ? (
                    <input
                      type="number"
                      step={itemType === 'integer' ? '1' : 'any'}
                      value={item ?? ''}
                      onChange={(e) => {
                        const parsed = e.target.value === '' ? '' : Number(e.target.value);
                        handleUpdateItem(idx, parsed);
                      }}
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-900 focus:outline-none focus:border-blue-500"
                    />
                  ) : (
                    <input
                      type="text"
                      value={item ?? ''}
                      onChange={(e) => handleUpdateItem(idx, e.target.value)}
                      placeholder={`Enter ${itemType} item`}
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-900 focus:outline-none focus:border-blue-500"
                    />
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => handleRemoveItem(idx)}
                  className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors mt-0.5"
                  title="Remove item"
                >
                  <TrashIcon size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // 3. Enum Dropdown
  if (field.enum && field.enum.length > 0) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-slate-800 flex items-center gap-1 font-mono">
            {field.name}
            {field.required && <span className="text-rose-500 font-bold">*</span>}
          </label>
          <span className="text-[10px] font-mono text-blue-600 bg-blue-50 px-1.5 py-0.2 rounded border border-blue-100">
            enum
          </span>
        </div>
        {field.description && (
          <p className="text-[11px] text-slate-500">{field.description}</p>
        )}
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-500 cursor-pointer"
        >
          <option value="">-- Select {field.name} --</option>
          {field.enum.map((opt: any) => (
            <option key={String(opt)} value={String(opt)}>
              {String(opt)}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // 4. Boolean Switch
  if (field.type === 'boolean') {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-slate-800 flex items-center gap-1 font-mono">
            {field.name}
            {field.required && <span className="text-rose-500 font-bold">*</span>}
          </label>
          <span className="text-[10px] font-mono text-slate-400">boolean</span>
        </div>
        {field.description && (
          <p className="text-[11px] text-slate-500">{field.description}</p>
        )}
        <div className="flex items-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={() => onChange(true)}
            className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${
              value === true
                ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            True
          </button>
          <button
            type="button"
            onClick={() => onChange(false)}
            className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${
              value === false
                ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            False
          </button>
        </div>
      </div>
    );
  }

  // 5. Number / Integer
  if (field.type === 'integer' || field.type === 'number') {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-slate-800 flex items-center gap-1 font-mono">
            {field.name}
            {field.required && <span className="text-rose-500 font-bold">*</span>}
          </label>
          <span className="text-[10px] font-mono text-slate-400">{field.type}</span>
        </div>
        {field.description && (
          <p className="text-[11px] text-slate-500">{field.description}</p>
        )}
        <input
          type="number"
          step={field.type === 'integer' ? '1' : 'any'}
          value={value ?? ''}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') {
              onChange('');
            } else if (field.type === 'integer') {
              onChange(parseInt(raw, 10));
            } else {
              onChange(parseFloat(raw));
            }
          }}
          placeholder={field.default !== undefined ? `Default: ${field.default}` : `Enter numeric value`}
          className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-500 font-mono"
        />
      </div>
    );
  }

  // 6. Multiline string detection
  const isMultiline =
    field.name.toLowerCase().includes('description') ||
    field.name.toLowerCase().includes('body') ||
    field.name.toLowerCase().includes('content') ||
    field.name.toLowerCase().includes('message');

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-slate-800 flex items-center gap-1 font-mono">
          {field.name}
          {field.required && <span className="text-rose-500 font-bold">*</span>}
        </label>
        <span className="text-[10px] font-mono text-slate-400">{field.type || 'string'}</span>
      </div>
      {field.description && (
        <p className="text-[11px] text-slate-500">{field.description}</p>
      )}
      {isMultiline ? (
        <textarea
          rows={3}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.default !== undefined ? `Default: ${field.default}` : `Enter ${field.name}`}
          className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-500 resize-y font-mono"
        />
      ) : (
        <input
          type="text"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.default !== undefined ? `Default: ${field.default}` : `Enter ${field.name}`}
          className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-500 font-mono"
        />
      )}
    </div>
  );
};

const HttpRequestForm: React.FC<HttpRequestFormProps> = ({
  schema,
  endpoint,
  onClose,
  onSuccessCheck,
}) => {
  const queryClient = useQueryClient();
  const supportsBody = ['POST', 'PUT', 'PATCH'].includes(endpoint.method.toUpperCase());

  // Default initial active tab
  const [activeTab, setActiveTab] = useState<'params' | 'headers' | 'body'>(() => {
    if (schema.path_parameters.length > 0 || schema.query_parameters.length > 0) return 'params';
    if (supportsBody) return 'body';
    return 'params';
  });

  const [bodyMode, setBodyMode] = useState<'fields' | 'raw'>(() => {
    return schema.request_body?.fields && schema.request_body.fields.length > 0 ? 'fields' : 'raw';
  });

  const [responseTab, setResponseTab] = useState<'body' | 'headers'>('body');

  // Path parameters state
  const [pathParams, setPathParams] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    schema.path_parameters.forEach((p) => {
      initial[p.name] = p.default ? String(p.default) : '';
    });
    return initial;
  });

  // Query parameters state
  const [queryParams, setQueryParams] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    schema.query_parameters.forEach((q) => {
      initial[q.name] = q.default !== undefined && q.default !== null ? String(q.default) : '';
    });
    return initial;
  });

  const [customQueryParams, setCustomQueryParams] = useState<Array<{ key: string; value: string }>>([]);

  // Headers state
  const [headers, setHeaders] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    schema.headers.forEach((h) => {
      initial[h.name] = h.default ? String(h.default) : '';
    });
    return initial;
  });

  const [customHeaders, setCustomHeaders] = useState<Array<{ key: string; value: string }>>([]);

  // Content-Type selection
  const [contentType, setContentType] = useState<string>(() => {
    return schema.request_body?.content_type || 'application/json';
  });

  // Body Form State initialized recursively from schema
  const [bodyForm, setBodyForm] = useState<Record<string, any>>(() => {
    const initial: Record<string, any> = {};
    if (schema.request_body?.fields) {
      schema.request_body.fields.forEach((f) => {
        initial[f.name] = buildDefaultFieldValue(f);
      });
    }
    return initial;
  });

  const [rawBody, setRawBody] = useState<string>(() => {
    if (schema.request_body?.fields && schema.request_body.fields.length > 0) {
      const initial: Record<string, any> = {};
      schema.request_body.fields.forEach((f) => {
        initial[f.name] = buildDefaultFieldValue(f);
      });
      return JSON.stringify(initial, null, 2);
    }
    return schema.request_body ? '{\n  \n}' : '';
  });

  // Execution Result
  const [lastResponse, setLastResponse] = useState<CheckResponse | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Execute request mutation
  const executeMutation = useMutation({
    mutationFn: async (payload: any) => {
      return apiFetch<CheckResponse>(`/endpoints/${endpoint.id}/checks`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (data) => {
      setLastResponse(data);
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ['endpoints'] });
      if (onSuccessCheck) {
        onSuccessCheck();
      }
    },
    onError: (err: any) => {
      setFormError(err.message || 'Failed to submit request');
    },
  });

  const handleRawBodyChange = (value: string) => {
    setRawBody(value);
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        setBodyForm(parsed);
      }
    } catch {
      // Keep editing raw
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // 1. Validate path params
    if (schema.path_parameters) {
      for (const p of schema.path_parameters) {
        if (p.required && (!pathParams[p.name] || pathParams[p.name].trim() === '')) {
          setFormError(`Path parameter "${p.name}" is required.`);
          setActiveTab('params');
          return;
        }
      }
    }

    // 2. Merge query parameters
    const mergedQuery: Record<string, string> = {};
    Object.entries(queryParams).forEach(([k, v]) => {
      if (v !== '') mergedQuery[k] = v;
    });
    customQueryParams.forEach((item) => {
      if (item.key.trim() && item.value.trim()) {
        mergedQuery[item.key.trim()] = item.value.trim();
      }
    });

    // 3. Merge headers
    const mergedHeaders: Record<string, string> = {};
    Object.entries(headers).forEach(([k, v]) => {
      if (v !== '') mergedHeaders[k] = v;
    });
    customHeaders.forEach((item) => {
      if (item.key.trim() && item.value.trim()) {
        mergedHeaders[item.key.trim()] = item.value.trim();
      }
    });

    // 4. Prepare and validate body
    let finalBody: any = null;
    if (supportsBody) {
      if (bodyMode === 'fields' && schema.request_body?.fields && schema.request_body.fields.length > 0) {
        const validationError = validateBodyFields(schema.request_body.fields, bodyForm);
        if (validationError) {
          setFormError(validationError);
          setActiveTab('body');
          return;
        }
        finalBody = bodyForm;
      } else if (rawBody.trim()) {
        try {
          finalBody = JSON.parse(rawBody);
        } catch {
          finalBody = rawBody;
        }
      }
    }

    setFormError(null);
    executeMutation.mutate({
      path_params: Object.keys(pathParams).length > 0 ? pathParams : null,
      query_params: Object.keys(mergedQuery).length > 0 ? mergedQuery : null,
      headers: Object.keys(mergedHeaders).length > 0 ? mergedHeaders : null,
      body: finalBody,
      content_type: contentType,
    });
  };

  const getStatusBadge = (status: number | null, success?: boolean) => {
    if (status == null || (success === false && status >= 400)) {
      return (
        <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
          {status ? `${status} Error` : 'Error / No Response'}
        </span>
      );
    }
    if (status >= 200 && status < 300) {
      return (
        <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
          {status} OK
        </span>
      );
    }
    if (status >= 300 && status < 400) {
      return (
        <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
          {status} Redirect
        </span>
      );
    }
    if (status >= 400 && status < 500) {
      return (
        <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
          {status} Client Error
        </span>
      );
    }
    return (
      <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
        {status} Server Error
      </span>
    );
  };

  const availableContentTypes = schema.request_body?.content_types || [
    'application/json',
    'application/x-www-form-urlencoded',
    'text/plain',
  ];

  return (
    <div className="space-y-6">
      {formError && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
          <AlertTriangleIcon size={14} className="flex-shrink-0" />
          <span>{formError}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Request Configuration Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
          <button
            type="button"
            onClick={() => setActiveTab('params')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'params'
                ? 'bg-blue-50 text-blue-700 border border-blue-200 shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            Parameters
            {((schema.path_parameters.length || 0) + (schema.query_parameters.length || 0)) > 0 && (
              <span className="ml-1.5 px-1.5 py-0.2 bg-blue-100 text-blue-800 rounded-full text-[10px]">
                {(schema.path_parameters.length || 0) + (schema.query_parameters.length || 0)}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('headers')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'headers'
                ? 'bg-blue-50 text-blue-700 border border-blue-200 shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            Headers
            {customHeaders.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.2 bg-blue-100 text-blue-800 rounded-full text-[10px]">
                {customHeaders.length}
              </span>
            )}
          </button>

          {supportsBody && (
            <button
              type="button"
              onClick={() => setActiveTab('body')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'body'
                  ? 'bg-blue-50 text-blue-700 border border-blue-200 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              Request Body
              {schema.request_body?.required && (
                <span className="ml-1.5 text-[10px] text-amber-600 font-bold">*</span>
              )}
            </button>
          )}
        </div>

        {/* ── TAB 1: PARAMETERS ── */}
        {activeTab === 'params' && (
          <div className="space-y-5">
            {/* Path Parameters Section */}
            {schema.path_parameters && schema.path_parameters.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                    Path Parameters
                  </label>
                  <span className="text-[11px] text-slate-500">Substituted directly into endpoint URL route</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {schema.path_parameters.map((p) => (
                    <div key={p.name} className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-slate-900">{p.name}</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-slate-500 font-mono">{p.type}</span>
                          {p.required && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                              Required
                            </span>
                          )}
                        </div>
                      </div>
                      {p.description && (
                        <p className="text-[11px] text-slate-500 leading-tight">{p.description}</p>
                      )}
                      <input
                        type="text"
                        value={pathParams[p.name] ?? ''}
                        onChange={(e) => setPathParams({ ...pathParams, [p.name]: e.target.value })}
                        placeholder={`e.g. 123`}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono text-slate-900 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Query Parameters Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                  Query Parameters (?key=value)
                </label>
                <button
                  type="button"
                  onClick={() => setCustomQueryParams([...customQueryParams, { key: '', value: '' }])}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
                >
                  <PlusIcon size={13} />
                  <span>Add Query Param</span>
                </button>
              </div>

              {schema.query_parameters.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {schema.query_parameters.map((q) => (
                    <div key={q.name} className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-slate-900">{q.name}</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-slate-500 font-mono">{q.type}</span>
                          {q.required && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                              Required
                            </span>
                          )}
                        </div>
                      </div>
                      {q.description && (
                        <p className="text-[11px] text-slate-500 leading-tight">{q.description}</p>
                      )}
                      {q.enum && q.enum.length > 0 ? (
                        <select
                          value={queryParams[q.name] ?? ''}
                          onChange={(e) => setQueryParams({ ...queryParams, [q.name]: e.target.value })}
                          className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-500 cursor-pointer"
                        >
                          <option value="">-- Choose {q.name} --</option>
                          {q.enum.map((opt: any) => (
                            <option key={String(opt)} value={String(opt)}>
                              {String(opt)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={queryParams[q.name] ?? ''}
                          onChange={(e) => setQueryParams({ ...queryParams, [q.name]: e.target.value })}
                          placeholder={q.default !== undefined ? `Default: ${q.default}` : `Value for ${q.name}`}
                          className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono text-slate-900 focus:outline-none focus:border-blue-500"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Custom Query Params */}
              {customQueryParams.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Parameter Key"
                    value={item.key}
                    onChange={(e) => {
                      const copy = [...customQueryParams];
                      copy[idx].key = e.target.value;
                      setCustomQueryParams(copy);
                    }}
                    className="w-1/2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-500 font-mono"
                  />
                  <input
                    type="text"
                    placeholder="Parameter Value"
                    value={item.value}
                    onChange={(e) => {
                      const copy = [...customQueryParams];
                      copy[idx].value = e.target.value;
                      setCustomQueryParams(copy);
                    }}
                    className="w-1/2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setCustomQueryParams(customQueryParams.filter((_, i) => i !== idx))}
                    className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── TAB 2: HEADERS ── */}
        {activeTab === 'headers' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                HTTP Request Headers
              </label>
              <button
                type="button"
                onClick={() => setCustomHeaders([...customHeaders, { key: '', value: '' }])}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                <PlusIcon size={13} />
                <span>Add Custom Header</span>
              </button>
            </div>

            {schema.headers.length > 0 && (
              schema.headers.map((h) => (
                <div key={h.name} className="flex items-center gap-3">
                  <div className="w-1/2">
                    <span className="font-mono text-xs font-bold text-slate-800">{h.name}</span>
                    {h.required && <span className="text-rose-500 font-bold ml-1">*</span>}
                    {h.description && (
                      <p className="text-[11px] text-slate-500 truncate">{h.description}</p>
                    )}
                  </div>
                  <input
                    type="text"
                    value={headers[h.name] ?? ''}
                    onChange={(e) => setHeaders({ ...headers, [h.name]: e.target.value })}
                    placeholder={`Enter ${h.name}`}
                    className="w-1/2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
              ))
            )}

            {customHeaders.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Header Name (e.g. Authorization, X-API-Key)"
                  value={item.key}
                  onChange={(e) => {
                    const copy = [...customHeaders];
                    copy[idx].key = e.target.value;
                    setCustomHeaders(copy);
                  }}
                  className="w-1/2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-500 font-mono"
                />
                <input
                  type="text"
                  placeholder="Header Value"
                  value={item.value}
                  onChange={(e) => {
                    const copy = [...customHeaders];
                    copy[idx].value = e.target.value;
                    setCustomHeaders(copy);
                  }}
                  className="w-1/2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-500 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setCustomHeaders(customHeaders.filter((_, i) => i !== idx))}
                  className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
                >
                  <TrashIcon size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── TAB 3: REQUEST BODY (POST / PUT / PATCH) ── */}
        {activeTab === 'body' && supportsBody && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <label className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                  Request Body Payload
                </label>
                {/* Content-Type selector */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-slate-500">Content-Type:</span>
                  <select
                    value={contentType}
                    onChange={(e) => setContentType(e.target.value)}
                    className="px-2 py-1 text-xs font-mono bg-slate-100 border border-slate-200 rounded-md text-slate-800 focus:outline-none focus:border-blue-500"
                  >
                    {availableContentTypes.map((ct) => (
                      <option key={ct} value={ct}>
                        {ct}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {schema.request_body?.fields && schema.request_body.fields.length > 0 && (
                <div className="flex items-center p-0.5 bg-slate-100 rounded-lg border border-slate-200 text-xs">
                  <button
                    type="button"
                    onClick={() => setBodyMode('fields')}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                      bodyMode === 'fields' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    Schema Form
                  </button>
                  <button
                    type="button"
                    onClick={() => setBodyMode('raw')}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                      bodyMode === 'raw' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    Raw JSON
                  </button>
                </div>
              )}
            </div>

            {bodyMode === 'fields' && schema.request_body?.fields && schema.request_body.fields.length > 0 ? (
              <div className="space-y-4 p-4 rounded-xl bg-slate-50/70 border border-slate-200">
                <div className="text-[11px] text-slate-500 pb-1 border-b border-slate-200/60">
                  Form fields generated from endpoint OpenAPI schema. All required fields are marked with an asterisk (*).
                </div>
                <div className="space-y-4">
                  {schema.request_body.fields.map((f) => (
                    <BodyFieldItem
                      key={f.name}
                      field={f}
                      value={bodyForm[f.name]}
                      onChange={(newVal) => {
                        const updated = { ...bodyForm, [f.name]: newVal };
                        setBodyForm(updated);
                        setRawBody(JSON.stringify(updated, null, 2));
                      }}
                      depth={0}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <textarea
                  rows={8}
                  value={rawBody}
                  onChange={(e) => handleRawBodyChange(e.target.value)}
                  placeholder="Enter JSON request body (e.g. { ... })"
                  className="w-full p-3 font-mono text-xs bg-slate-900 text-slate-100 rounded-xl border border-slate-800 focus:outline-none focus:border-blue-500 resize-y"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Submit valid JSON payload matching endpoint requirements. Leave blank if this endpoint takes no body.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Submit Action Bar */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-100">
          <div className="text-xs text-slate-500">
            Target: <span className="font-mono text-slate-800 font-semibold">{endpoint.url}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={executeMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs hover:shadow-md transition-all disabled:opacity-50 cursor-pointer"
            >
              {executeMutation.isPending ? (
                <>
                  <RefreshIcon size={14} className="animate-spin" />
                  <span>Sending Request...</span>
                </>
              ) : (
                <>
                  <PlayIcon size={14} />
                  <span>Send {endpoint.method} Request</span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* ── RESPONSE SECTION ── */}
      {lastResponse && (
        <div className="mt-6 pt-6 border-t border-slate-200 space-y-4 animate-fade-in">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Live Server Response
              </h3>
              {getStatusBadge(lastResponse.status_code, lastResponse.success)}
              {lastResponse.latency_ms != null && (
                <span className="text-xs font-mono font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                  {Math.round(lastResponse.latency_ms)} ms
                </span>
              )}
              {lastResponse.content_type && (
                <span className="text-xs font-mono text-slate-500">
                  {lastResponse.content_type.split(';')[0]}
                </span>
              )}
            </div>

            {/* Sub-tabs for Response Body vs Headers */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
              <button
                type="button"
                onClick={() => setResponseTab('body')}
                className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                  responseTab === 'body' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Response Body
              </button>
              <button
                type="button"
                onClick={() => setResponseTab('headers')}
                className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                  responseTab === 'headers' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Response Headers
              </button>
            </div>
          </div>

          {/* Failure diagnosis banner if any */}
          {lastResponse.failure_reason && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <AlertTriangleIcon size={14} />
                <span>Diagnosis: {lastResponse.failure_reason}</span>
              </div>
              {lastResponse.error_detail && (
                <div className="font-mono text-[11px] text-amber-900 pl-5">
                  {lastResponse.error_detail}
                </div>
              )}
            </div>
          )}

          {/* Response Viewer or Headers */}
          {responseTab === 'body' ? (
            <ResponseViewer
              responseBody={lastResponse.response_body}
              contentType={lastResponse.content_type}
              statusCode={lastResponse.status_code}
            />
          ) : (
            <div className="p-4 bg-slate-900 text-slate-100 rounded-xl border border-slate-800 max-h-72 overflow-y-auto">
              {lastResponse.response_headers ? (
                (() => {
                  try {
                    const parsedHeaders = JSON.parse(lastResponse.response_headers);
                    return (
                      <div className="divide-y divide-slate-800 font-mono text-xs">
                        {Object.entries(parsedHeaders).map(([k, v]) => (
                          <div key={k} className="py-1.5 flex items-start gap-4">
                            <span className="font-semibold text-sky-400 min-w-36 break-all">{k}</span>
                            <span className="text-slate-300 break-all">{String(v)}</span>
                          </div>
                        ))}
                      </div>
                    );
                  } catch {
                    return <pre className="font-mono text-xs">{lastResponse.response_headers}</pre>;
                  }
                })()
              ) : (
                <p className="text-xs text-slate-400">No response headers captured.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const HttpRequestModal: React.FC<HttpRequestModalProps> = ({
  isOpen,
  onClose,
  endpoint,
  onSuccessCheck,
}) => {
  // Fetch actual schema
  const { data: schema, isLoading: isSchemaLoading } = useQuery<EndpointSchema>({
    queryKey: ['endpoint-schema', endpoint.id],
    queryFn: () => apiFetch(`/endpoints/${endpoint.id}/schema`),
    enabled: isOpen,
  });

  if (!isOpen) return null;

  const getMethodBadgeClass = (m: string) => {
    switch (m.toUpperCase()) {
      case 'GET': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'POST': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'PUT': return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'PATCH': return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'DELETE': return 'bg-rose-50 text-rose-700 border-rose-200';
      default: return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
      <div
        className="w-full max-w-4xl max-h-[92vh] flex flex-col bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-3 min-w-0">
            <span className={`px-2 py-0.5 rounded-md text-xs font-mono font-bold border ${getMethodBadgeClass(endpoint.method)}`}>
              {endpoint.method}
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900 truncate font-mono">
                {endpoint.path || endpoint.url}
              </h2>
              {endpoint.name && endpoint.name !== endpoint.url && (
                <p className="text-[11px] text-slate-500 truncate">{endpoint.name}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 transition-colors cursor-pointer"
            title="Close modal"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isSchemaLoading || !schema ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-400 text-xs">
              <RefreshIcon size={18} className="animate-spin text-blue-600" />
              <span>Inspecting endpoint schema & accepted parameters...</span>
            </div>
          ) : (
            <HttpRequestForm
              key={schema.endpoint_id}
              schema={schema}
              endpoint={endpoint}
              onClose={onClose}
              onSuccessCheck={onSuccessCheck}
            />
          )}
        </div>
      </div>
    </div>
  );
};
