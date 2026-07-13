// NIM (build.nvidia.com) embeddings, isolated so every write route calls one
// function. Graceful by design: on any failure this returns null and never
// throws — writes must succeed even when NIM is down or NVIDIA_API_KEY is
// unset (personal-scale, best-effort "related" panel over a hard requirement).

const NIM_EMBEDDINGS_URL = 'https://integrate.api.nvidia.com/v1/embeddings'
const EMBED_MODEL = 'nvidia/nv-embedqa-e5-v5'

export async function embedText(
  env: { NVIDIA_API_KEY?: string } | undefined,
  text: string
): Promise<number[] | null> {
  if (!env?.NVIDIA_API_KEY) return null

  const input = text?.slice(0, 8000) || ' '

  try {
    const res = await fetch(NIM_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBED_MODEL,
        input: [input],
        input_type: 'passage',
        truncate: 'END',
      }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      console.error('embedText: NIM returned non-2xx', res.status)
      return null
    }

    const data: any = await res.json()
    const embedding = data?.data?.[0]?.embedding
    if (!Array.isArray(embedding) || embedding.length === 0) {
      console.error('embedText: unexpected NIM response shape')
      return null
    }

    return embedding as number[]
  } catch (err) {
    console.error('embedText: NIM call failed', err)
    return null
  }
}

// Standard cosine similarity. Guards zero-norm vectors (returns 0 rather
// than NaN/Infinity).
export function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}
