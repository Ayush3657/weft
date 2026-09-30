import { describe, expect, it } from 'vitest'
import { UnfurlError, isPublicAddress, parsePreview, parsePublicUrl } from '../src/unfurl'

describe('address safety', () => {
  it('allows public addresses only', () => {
    expect(isPublicAddress('93.184.216.34')).toBe(true)
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true)
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.5.5', '192.168.1.20', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:192.168.0.1']) {
      expect(isPublicAddress(ip), ip).toBe(false)
    }
  })

  it('rejects links that point at this machine, the network or odd schemes', () => {
    for (const bad of ['http://127.0.0.1/', 'http://localhost:8787/api/me', 'http://169.254.169.254/latest/meta-data', 'file:///etc/passwd', 'ftp://example.com', 'http://user:pw@example.com', 'http://[::1]/', 'http://printer.local/', 'not a url']) {
      expect(() => parsePublicUrl(bad), bad).toThrow(UnfurlError)
    }
    expect(parsePublicUrl('https://www.youtube.com/watch?v=abc').hostname).toBe('www.youtube.com')
  })
})

describe('preview parsing', () => {
  it('reads Open Graph tags, falling back to <title>', () => {
    const html = `<html><head>
      <title>Fallback title</title>
      <meta property="og:title" content="Skyline Towers &amp; Gardens">
      <meta name="description" content="Homes with room to grow">
      <meta property="og:image" content="/img/hero.jpg">
      <meta property="og:site_name" content="Skyline">
    </head><body><meta property="og:title" content="ignored"></body></html>`
    expect(parsePreview(html, new URL('https://example.com/project/1'))).toEqual({
      title: 'Skyline Towers & Gardens',
      description: 'Homes with room to grow',
      image: 'https://example.com/img/hero.jpg',
      site: 'Skyline',
    })
  })

  it('uses the title tag and hostname when there are no meta tags', () => {
    const preview = parsePreview('<head><title> Plain page </title></head>', new URL('https://www.example.org/x'))
    expect(preview).toMatchObject({ title: 'Plain page', image: null, site: 'example.org' })
  })
})
