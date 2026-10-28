/**
 * DeepSeek 客户端：浏览器直连（官方对任意 Origin 回显 CORS 头，含错误响应）。
 * 覆盖 Chat Completions、流式解析、JSON 模式、Search / Fetch 工具与费用核算。
 */
import { AppError, explainDeepSeek } from '../lib/errors';
import type { ModelPrice } from '../types';

export const DEEPSEEK_BASE = 'https://api.deepseek.com';

export const MODELS: ModelPrice[] = [
  {
    id: 'deepseek-flash',
    label: 'DeepSeek Flash',
    inputCachedCny: 0.02,
    inputMissCny: 1,
    outputCny: 4,
    note: 'V4.1-Flash，速度快、成本低，适合日常精读生成',
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    inputCachedCny: 0.15,
    inputMissCny: 4.5,
    outputCny: 13.5,
    note: 'V4-Pro，长文与命题质量更稳，成本约为 Flash 的 4.5 倍',
  },
];

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

export interface ChatResult {
  content: string;
  usage: TokenUsage;
  finishReason: string;
}

export interface ChatOptions {
  apiKey: string;
  model: string;
  json?: boolean;
  thinking?: boolean;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  onDelta?: (delta: string) => void;
}

function priceOf(model: string): ModelPrice {
  return MODELS.find((m) => m.id === model) ?? MODELS[0];
}

/** 北京时间高峰时段：周一至周五 9:00-12:00、14:00-18:00（法定节假日无法在前端判断，仅作提示） */
export function isPeakNow(date = new Date()): boolean {
  const beijing = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const day = beijing.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = beijing.getHours() * 60 + beijing.getMinutes();
  return (minutes >= 540 && minutes < 720) || (minutes >= 840 && minutes < 1080);
}

export function costOf(model: string, usage: TokenUsage | null, searchCalls = 0): number {
  const price = priceOf(model);
  const peak = isPeakNow() ? 2 : 1;
  const hit = usage?.prompt_cache_hit_tokens ?? 0;
  const miss = usage?.prompt_cache_miss_tokens ?? Math.max((usage?.prompt_tokens ?? 0) - hit, 0);
  const out = usage?.completion_tokens ?? 0;
  const modelCost =
    ((hit * price.inputCachedCny + miss * price.inputMissCny + out * price.outputCny) / 1_000_000) * peak;
  const searchCost = (searchCalls * 5) / 1000;
  return modelCost + searchCost;
}

/** 流式响应两帧之间允许的最长静默；超过即判定网络卡死，不再无限等待 */
const STREAM_IDLE_TIMEOUT = 45_000;

async function post(path: string, apiKey: string, body: unknown, signal?: AbortSignal, timeoutMs = 240_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(`${DEEPSEEK_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return res;
  } catch (err) {
    if (controller.signal.aborted) {
      throw new AppError('deepseek', signal?.aborted ? '请求已取消' : '请求超时（240 秒内没有完成）');
    }
    throw new AppError('deepseek', (err as Error).message || '网络请求失败');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function parseSseChunk(raw: string): { text: string; usage?: TokenUsage; finish?: string } | null {
  const lines = raw.split('\n').filter((l) => l.startsWith('data:'));
  if (!lines.length) return null;
  let text = '';
  let usage: TokenUsage | undefined;
  let finish: string | undefined;
  for (const line of lines) {
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const json = JSON.parse(payload) as {
        choices?: { delta?: { content?: string }; finish_reason?: string }[];
        usage?: TokenUsage | null;
      };
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) text += delta;
      const fr = json.choices?.[0]?.finish_reason;
      if (fr) finish = fr;
      if (json.usage) usage = json.usage;
    } catch {
      // 单行解析失败不影响整体
    }
  }
  return { text, usage, finish };
}

export async function chat(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> {
  if (!opts.apiKey) throw new AppError('deepseek', '尚未填写 DeepSeek API Key');
  const body: Record<string, unknown> = {
    model: opts.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: opts.maxTokens ?? 8000,
  };
  if (opts.json) body.response_format = { type: 'json_object' };
  body.thinking = { type: opts.thinking ? 'enabled' : 'disabled' };
  if (!opts.thinking) body.temperature = opts.temperature ?? 0.8;
  if (opts.thinking) body.reasoning_effort = 'high';

  const res = await post('/chat/completions', opts.apiKey, body, opts.signal, opts.timeoutMs);
  if (!res.ok) {
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    const explained = explainDeepSeek(res.status, payload);
    throw new AppError('deepseek', explained.title, {
      status: res.status,
      raw: (payload as { error?: { message?: string } } | null)?.error?.message,
    });
  }
  if (!res.body) throw new AppError('deepseek', '响应没有可读取的流');

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let content = '';
  let usage: TokenUsage = { prompt_tokens: 0, completion_tokens: 0 };
  let finish = 'stop';
  for (;;) {
    // post() 的超时只覆盖到拿到响应头为止；进入流式读取后必须自己盯着心跳，
    // 否则网络半途卡死会一直挂着不退，用户既看不到进度也拿不到错误。
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const idle = new Promise<never>((_, reject) => {
      idleTimer = setTimeout(() => {
        reject(
          new AppError(
            'deepseek',
            `流式响应中断：连续 ${Math.round(STREAM_IDLE_TIMEOUT / 1000)} 秒没有收到新数据，请检查网络后重试本阶段`,
          ),
        );
      }, STREAM_IDLE_TIMEOUT);
    });

    let read: ReadableStreamReadResult<Uint8Array>;
    try {
      read = await Promise.race([reader.read(), idle]);
    } catch (err) {
      // 卡死时主动取消底层流，避免连接残留
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
    }

    const { value, done } = read;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split = buffer.indexOf('\n\n');
    while (split >= 0) {
      const chunk = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const parsed = parseSseChunk(chunk);
      if (parsed) {
        if (parsed.text) {
          content += parsed.text;
          opts.onDelta?.(parsed.text);
        }
        if (parsed.usage) usage = parsed.usage;
        if (parsed.finish) finish = parsed.finish;
      }
      split = buffer.indexOf('\n\n');
    }
  }
  if (buffer.trim()) {
    const parsed = parseSseChunk(buffer);
    if (parsed) {
      if (parsed.text) {
        content += parsed.text;
        opts.onDelta?.(parsed.text);
      }
      if (parsed.usage) usage = parsed.usage;
      if (parsed.finish) finish = parsed.finish;
    }
  }
  if (!content.trim()) {
    throw new AppError('parse', '模型返回了空内容（JSON 模式偶发），请重试本阶段');
  }
  return { content, usage, finishReason: finish };
}

/** 从可能带 ```json 包装的文本里取出 JSON */
export function extractJson<T>(raw: string): T {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new AppError('parse', '返回内容里找不到 JSON 对象');
  const slice = candidate.slice(start, end + 1);
  try {
    return JSON.parse(slice) as T;
  } catch (err) {
    throw new AppError('parse', `JSON 解析失败：${(err as Error).message}`);
  }
}

export interface SearchHit {
  title: string;
  url: string;
  summary: string;
  siteName?: string | null;
  authority?: number;
}

/** 官方 Search 工具（api.deepseek.com/v1/tools/search），按成功请求计费 */
export async function searchWeb(apiKey: string, query: string, count = 6): Promise<SearchHit[]> {
  const res = await post('/v1/tools/search', apiKey, { query, count, need_content: false }, undefined, 60_000);
  if (!res.ok) {
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    const explained = explainDeepSeek(res.status, payload);
    throw new AppError('deepseek', `联网检索失败：${explained.title}`, {
      status: res.status,
      raw: (payload as { error?: { message?: string } } | null)?.error?.message,
    });
  }
  const json = (await res.json()) as { results?: SearchHit[] };
  return json.results ?? [];
}

export interface KeyCheck {
  ok: boolean;
  detail: string;
  models: string[];
  /** 已在浏览器拿到真实响应（用于区分 CORS 与凭证问题） */
  reachable: boolean;
  latencyMs: number;
}

/** 验证 Key：直接发一个最小请求，读得回 401/200 即说明浏览器直连可用 */
export async function verifyKey(apiKey: string): Promise<KeyCheck> {
  const started = performance.now();
  try {
    const res = await post(
      '/chat/completions',
      apiKey,
      {
        model: 'deepseek-flash',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
        thinking: { type: 'disabled' },
      },
      undefined,
      30_000,
    );
    const latencyMs = Math.round(performance.now() - started);
    if (res.ok) {
      return { ok: true, detail: '连接正常，浏览器可直连 DeepSeek', models: MODELS.map((m) => m.id), reachable: true, latencyMs };
    }
    const payload = await res.json().catch(() => null);
    const explained = explainDeepSeek(res.status, payload);
    return { ok: false, detail: `${explained.title}：${explained.detail}`, models: [], reachable: true, latencyMs };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    return {
      ok: false,
      detail: `未能读取响应：${(err as Error).message}。请检查网络或代理设置。`,
      models: [],
      reachable: false,
      latencyMs,
    };
  }
}
