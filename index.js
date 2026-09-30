addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)
  const targetUrl = url.searchParams.get('url')

  // Página de inicio sencilla si no se pasa ninguna URL
  if (!targetUrl) {
    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>Mi Proxy Web</title>
        <style>
          body { font-family: sans-serif; text-align: center; margin-top: 50px; background: #121212; color: white; }
          input { padding: 10px; width: 300px; border-radius: 5px; border: none; }
          button { padding: 10px 15px; border-radius: 5px; border: none; background: #0070f3; color: white; cursor: pointer; }
        </style>
      </head>
      <body>
        <h1>Mi Proxy Web</h1>
        <form action="/" method="GET">
          <input type="text" name="url" placeholder="https://ejemplo.com" required>
          <button type="submit">Navegar</button>
        </form>
      </body>
      </html>
    `
    return new Response(html, { headers: { 'content-type': 'text/html;charset=UTF-8' } })
  }

  // Evitar que el proxy se llame a sí mismo (error 1042)
  if (targetUrl.includes(url.host)) {
    return new Response('No puedes usar el proxy sobre sí mismo.', { status: 400 })
  }

  try {
    let modifiedUrl = targetUrl
    if (!modifiedUrl.startsWith('http://') && !modifiedUrl.startsWith('https://')) {
      modifiedUrl = 'https://' + modifiedUrl
    }
    const target = new URL(modifiedUrl)

    // Convierte cualquier enlace en un enlace que pase por el proxy
    const proxify = (link) => {
      if (!link || /^(#|javascript:|mailto:|data:|tel:|blob:)/i.test(link.trim())) return link
      try {
        return url.origin + '/?url=' + encodeURIComponent(new URL(link.trim(), target).toString())
      } catch (e) {
        return link
      }
    }

    // Cabeceras limpias (no reenviamos las del navegador)
    const headers = new Headers()
    headers.set('User-Agent', request.headers.get('User-Agent') || 'Mozilla/5.0')
    headers.set('Accept', request.headers.get('Accept') || '*/*')
    headers.set('Accept-Language', request.headers.get('Accept-Language') || 'es-ES,es;q=0.9')

    const response = await fetch(target.toString(), {
      method: request.method,
      headers: headers,
      body: (request.method === 'GET' || request.method === 'HEAD') ? null : request.body,
      redirect: 'manual'
    })

    const newHeaders = new Headers(response.headers)
    newHeaders.set('Access-Control-Allow-Origin', '*')
    newHeaders.delete('content-security-policy')
    newHeaders.delete('x-frame-options')
    newHeaders.delete('x-content-type-options')

    // Redirecciones: mantenerlas dentro del proxy
    if (response.status >= 300 && response.status < 400 && newHeaders.get('location')) {
      newHeaders.set('location', proxify(newHeaders.get('location')))
      return new Response(null, { status: response.status, headers: newHeaders })
    }

    const contentType = newHeaders.get('content-type') || ''

    // CSS: reescribir los url(...) internos
    if (contentType.includes('text/css')) {
      let css = await response.text()
      css = css.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, (m, u) => {
        if (u.startsWith('data:')) return m
        return 'url("' + proxify(u) + '")'
      })
      newHeaders.delete('content-length')
      return new Response(css, { status: response.status, headers: newHeaders })
    }

    // HTML: reescribir enlaces y recursos
    if (contentType.includes('text/html')) {
      newHeaders.delete('content-length')

      const attr = (name) => ({
        element(el) {
          const v = el.getAttribute(name)
          if (v) el.setAttribute(name, proxify(v))
        }
      })

      const srcset = {
        element(el) {
          const v = el.getAttribute('srcset')
          if (v) {
            el.setAttribute('srcset', v.split(',').map(part => {
              const [u, size] = part.trim().split(/\s+/)
              return proxify(u) + (size ? ' ' + size : '')
            }).join(', '))
          }
        }
      }

      const base = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      })

      return new HTMLRewriter()
        .on('a[href]', attr('href'))
        .on('link[href]', attr('href'))
        .on('link[integrity]', { element(el) { el.removeAttribute('integrity') } })
        .on('script[src]', attr('src'))
        .on('img[src]', attr('src'))
        .on('img[srcset]', srcset)
        .on('source[src]', attr('src'))
        .on('source[srcset]', srcset)
        .on('iframe[src]', attr('src'))
        .on('meta[http-equiv="refresh"]', { element(el) { el.remove() } })
        .transform(base)
    }

    // Cualquier otra cosa (imágenes, JS, fuentes...) se devuelve tal cual
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    })
  } catch (err) {
    return new Response('Error: ' + err.message, { status: 500 })
  }
}
