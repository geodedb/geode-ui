import {
  ADMIN_WRITABLE_NONE,
  fetchCapabilities,
  type AdminWritable,
  type Capabilities,
} from '../api/capabilities'
import { useApiResource } from './useApiResource'

// useCapabilities fetches GET /api/v1/capabilities once per mount and
// exposes the narrowed `admin_writable` flags. It's a thin wrapper over
// useApiResource (same AbortController / stale-resolve discipline as the
// admin list pages) so each Admin sub-page can gate its create CTA
// without threading a context through AdminPage.
//
// Until the fetch resolves — and if it fails — `adminWritable` is the
// conservative all-false default, so the CTAs render gated rather than
// flashing enabled. `loading` lets callers suppress the inline
// "unsupported" note while the probe is in flight if they prefer.

export interface UseCapabilitiesResult {
  adminWritable: AdminWritable
  geodeVersion: string
  loading: boolean
  /** Resolved successfully at least once. */
  loaded: boolean
}

export function useCapabilities(): UseCapabilitiesResult {
  const { data, status } = useApiResource<Capabilities>(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (_signal) => fetchCapabilities(),
    []
  )
  return {
    adminWritable: data?.adminWritable ?? ADMIN_WRITABLE_NONE,
    geodeVersion: data?.geodeVersion ?? '',
    loading: status === 'idle' || status === 'loading',
    loaded: data !== null,
  }
}
