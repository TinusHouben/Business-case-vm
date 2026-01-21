const KEY = "cart";

export function loadCart() {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCart(cart) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(cart));
  } catch {
    // ignore
  }
}

export function clearCart() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
