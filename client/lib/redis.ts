import { Redis } from '@upstash/redis'

/**
 * Server-side Upstash Redis client for fetching historical traces
 * and job state directly from the durable Redis store.
 *
 * Uses the same REST credentials as the FastAPI backend.
 */
export function getRedis(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    throw new Error('Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN')
  }
  return new Redis({ url, token })
}

export async function getTraces(jobUuid: string): Promise<string[]> {
  try {
    const redis = getRedis()
    const traces = await redis.lrange(`polaris:traces:${jobUuid}`, 0, -1)
    return traces ?? []
  } catch {
    return []
  }
}

export async function getJobState(jobUuid: string): Promise<Record<string, string>> {
  try {
    const redis = getRedis()
    const state = await redis.hgetall(`polaris:state:${jobUuid}`)
    if (!state) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(state)) {
      out[k] = typeof v === 'string' ? v : JSON.stringify(v)
    }
    return out
  } catch {
    return {}
  }
}
