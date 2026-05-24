/// <reference types="@testing-library/jest-dom" />
import { fetchCapabilities, ADMIN_WRITABLE_NONE } from './capabilities'

jest.mock('./client', () => ({ client: { getCapabilities: jest.fn() } }))
import { client } from './client'

const getCapabilities = client.getCapabilities as jest.Mock

beforeEach(() => {
  getCapabilities.mockReset()
})

describe('fetchCapabilities — security subsystem flags', () => {
  it('exposes attributes/rlsDenyPolicies/rlsAttributePolicies from admin_writable', async () => {
    getCapabilities.mockResolvedValue({
      geode_version: '0.5.20',
      admin_writable: {
        users: true,
        roles: true,
        policies: true,
        grants: true,
        attributes: true,
        rls_deny_policies: true,
        rls_attribute_policies: true,
      },
      metrics_enabled: true,
    })
    const caps = await fetchCapabilities()
    expect(caps.adminWritable.attributes).toBe(true)
    expect(caps.adminWritable.rlsDenyPolicies).toBe(true)
    expect(caps.adminWritable.rlsAttributePolicies).toBe(true)
    expect(caps.metricsEnabled).toBe(true)
  })

  it('defaults the new flags to false when omitted from the response', async () => {
    getCapabilities.mockResolvedValue({
      geode_version: '0.5.19',
      admin_writable: {
        users: true,
        roles: true,
        policies: true,
        grants: true,
      },
      metrics_enabled: false,
    })
    const caps = await fetchCapabilities()
    expect(caps.adminWritable.attributes).toBe(false)
    expect(caps.adminWritable.rlsDenyPolicies).toBe(false)
    expect(caps.adminWritable.rlsAttributePolicies).toBe(false)
  })
})

describe('ADMIN_WRITABLE_NONE', () => {
  it('has all seven flags set to false', () => {
    expect(ADMIN_WRITABLE_NONE).toEqual({
      users: false,
      roles: false,
      policies: false,
      grants: false,
      attributes: false,
      rlsDenyPolicies: false,
      rlsAttributePolicies: false,
    })
  })
})
