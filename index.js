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

  // Realizar la petición a la web destino
  try {
    let modifiedUrl = targetUrl
    if (!modifiedUrl.startsWith('http://') && !modifiedUrl.startsWith('https://')) {
      modifiedUrl = 'https://' + modifiedUrl
    }

    const response = await fetch(modifiedUrl, {
      method: request.method,
      headers: request.headers
    })

    // Retornar la respuesta permitiendo CORS
    const newHeaders = new Headers(response.headers)
    newHeaders.set('Access-Control-Allow-Origin', '*')

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    })
  } catch (err) {
    return new Response('Error al intentar cargar la página especificada.', { status: 500 })
  }
}
