export function getCurrentPath() {
  const raw = window.location.hash.replace(/^#/, '')
  return raw || '/'
}

export function navigate(path: string) {
  window.location.hash = path
}
