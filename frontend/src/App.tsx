import { useState, useEffect } from 'react';
import { apiClient } from './api/client';
import type { Candy } from './api/client';
import './App.css';

type BasketItem = {
  candyId: string;
  candy: Candy;
  quantity: number; // aantal keer 100g
};

const CART_STORAGE_KEY = 'snoepwinkel_basket_v1';

function loadBasketFromSession(): BasketItem[] {
  try {
    const raw = sessionStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BasketItem[];

    // Basic shape check
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x: any) => x && typeof x.candyId === 'string' && typeof x.quantity === 'number' && x.candy);
  } catch {
    return [];
  }
}

function saveBasketToSession(basket: BasketItem[]) {
  try {
    sessionStorage.setItem(CART_STORAGE_KEY, JSON.stringify(basket));
  } catch {
    // ignore
  }
}

function App() {
  const [loading, setLoading] = useState(false);
  const [loadingCandies, setLoadingCandies] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [candies, setCandies] = useState<Candy[]>([]);
  const [basket, setBasket] = useState<BasketItem[]>(() => loadBasketFromSession());
  const [showCheckout, setShowCheckout] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const [customerInfo, setCustomerInfo] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    postalCode: '',
  });

  // Load candies once
  useEffect(() => {
    loadCandies();
  }, []);

  // Persist basket on every change
  useEffect(() => {
    saveBasketToSession(basket);
  }, [basket]);

  // When candies are loaded, rehydrate basket candy objects (in case the list changed)
  useEffect(() => {
    if (candies.length === 0) return;

    setBasket((prev) =>
      prev
        .map((item) => {
          const freshCandy = candies.find((c) => c.id === item.candyId);
          return freshCandy ? { ...item, candy: freshCandy } : null;
        })
        .filter(Boolean) as BasketItem[]
    );
  }, [candies]);

  const loadCandies = async () => {
    try {
      setLoadingCandies(true);
      const response = await apiClient.getCandies();
      setCandies(response.candies);
    } catch (error: any) {
      showMessage('error', error.message || 'Failed to load candies');
    } finally {
      setLoadingCandies(false);
    }
  };

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const addToBasket = (candy: Candy) => {
    const existingItem = basket.find((item: BasketItem) => item.candyId === candy.id);
    if (existingItem) {
      setBasket(
        basket.map((item: BasketItem) =>
          item.candyId === candy.id ? { ...item, quantity: item.quantity + 1 } : item
        )
      );
    } else {
      setBasket([...basket, { candyId: candy.id, candy, quantity: 1 }]);
    }
    showMessage('success', `${candy.name} toegevoegd aan mandje!`);
  };

  const updateBasketQuantity = (candyId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromBasket(candyId);
      return;
    }
    setBasket(basket.map((item: BasketItem) => (item.candyId === candyId ? { ...item, quantity } : item)));
  };

  const removeFromBasket = (candyId: string) => {
    setBasket(basket.filter((item: BasketItem) => item.candyId !== candyId));
  };

  const clearBasket = () => {
    setBasket([]);
    try {
      sessionStorage.removeItem(CART_STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  const getTotalPrice = () => {
    return basket.reduce((total: number, item: BasketItem) => {
      return total + item.candy.pricePer100g * item.quantity;
    }, 0);
  };

  const getTotalWeight = () => {
    return basket.reduce((total: number, item: BasketItem) => total + item.quantity, 0) * 100;
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();

    if (basket.length === 0) {
      showMessage('error', 'Je mandje is leeg!');
      return;
    }

    if (!customerInfo.name || !customerInfo.email) {
      showMessage('error', 'Vul alstublieft naam en email in');
      return;
    }

    setLoading(true);
    try {
      const orderRequest = {
        basket: basket.map((item) => ({
          candyId: item.candyId,
          quantity: item.quantity,
        })),
        customerInfo,
      };

      const response = await apiClient.createCandyOrder(orderRequest);
      showMessage('success', `Bestelling geplaatst! Order ID: ${response.data.orderId}`);

      // Reset basket and form
      clearBasket();
      setShowCheckout(false);
      setCustomerInfo({
        name: '',
        email: '',
        phone: '',
        address: '',
        city: '',
        postalCode: '',
      });
    } catch (error: any) {
      showMessage('error', error.message || 'Failed to place order');
    } finally {
      setLoading(false);
    }
  };

  const categories = ['all', ...Array.from(new Set(candies.map((c) => c.category)))];
  const filteredCandies =
    selectedCategory === 'all' ? candies : candies.filter((c) => c.category === selectedCategory);

  return (
    <div className="app">
      <header className="header">
        <h1>🍬 Snoepjes Winkel 🍬</h1>
        <p style={{ marginTop: '0.5rem', color: '#999', fontSize: '0.9rem' }}>
          Bestel je favoriete snoepjes per 100 gram
        </p>
      </header>

      {message && <div className={`message ${message.type}`}>{message.text}</div>}

      <div className="shop-container">
        <aside className="basket-sidebar">
          <div className="basket-header">
            <h2>🛒 Winkelmandje</h2>
            {basket.length > 0 && (
              <button className="clear-basket-btn" onClick={clearBasket}>
                Leeg maken
              </button>
            )}
          </div>

          {basket.length === 0 ? (
            <div className="basket-empty">
              <p>Je mandje is leeg</p>
              <p className="basket-empty-hint">Voeg snoepjes toe om te beginnen!</p>
            </div>
          ) : (
            <>
              <div className="basket-items">
                {basket.map((item) => (
                  <div key={item.candyId} className="basket-item">
                    <div className="basket-item-info">
                      <strong>{item.candy.name}</strong>
                      <span className="basket-item-price">€{item.candy.pricePer100g.toFixed(2)} per 100g</span>
                    </div>
                    <div className="basket-item-controls">
                      <button className="quantity-btn" onClick={() => updateBasketQuantity(item.candyId, item.quantity - 1)}>
                        -
                      </button>
                      <span className="quantity-display">{item.quantity}x 100g</span>
                      <button className="quantity-btn" onClick={() => updateBasketQuantity(item.candyId, item.quantity + 1)}>
                        +
                      </button>
                      <button className="remove-btn" onClick={() => removeFromBasket(item.candyId)}>
                        ✕
                      </button>
                    </div>
                    <div className="basket-item-total">€{(item.candy.pricePer100g * item.quantity).toFixed(2)}</div>
                  </div>
                ))}
              </div>

              <div className="basket-summary">
                <div className="summary-row">
                  <span>Totaal gewicht:</span>
                  <strong>{getTotalWeight()}g</strong>
                </div>
                <div className="summary-row total">
                  <span>Totaal prijs:</span>
                  <strong>€{getTotalPrice().toFixed(2)}</strong>
                </div>
                <button className="checkout-btn" onClick={() => setShowCheckout(true)}>
                  Afrekenen
                </button>
              </div>
            </>
          )}
        </aside>

        <main className="candies-main">
          <div className="category-filter">
            {categories.map((category) => (
              <button
                key={category}
                className={`category-btn ${selectedCategory === category ? 'active' : ''}`}
                onClick={() => setSelectedCategory(category)}
              >
                {category === 'all' ? 'Alle Snoepjes' : category}
              </button>
            ))}
          </div>

          {loadingCandies ? (
            <div className="loading">Snoepjes laden...</div>
          ) : (
            <div className="candies-grid">
              {filteredCandies.map((candy) => {
                // Emoji fallback voor verschillende snoepjes categorieën
                const getCandyEmoji = (category: string) => {
                  const emojiMap: { [key: string]: string } = {
                    Zuur: '🍋',
                    Zacht: '🍬',
                    Drop: '🖤',
                    Chocolade: '🍫',
                    Fruit: '🍇',
                    Munt: '🌿',
                    Hard: '🍭',
                    Speciaal: '⭐',
                  };
                  return emojiMap[category] || '🍬';
                };

                const candyEmoji = getCandyEmoji(candy.category);

                return (
                  <div key={candy.id} className="candy-card">
                    <div className="candy-image-container">
                      {candy.image ? (
                        <img
                          src={candy.image}
                          alt={candy.name}
                          className="candy-image"
                          onError={(e) => {
                            // Fallback naar emoji als image niet laadt
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                            const emojiDiv = target.nextElementSibling as HTMLElement;
                            if (emojiDiv) emojiDiv.style.display = 'flex';
                          }}
                        />
                      ) : null}
                      <div className="candy-emoji" style={{ display: candy.image ? 'none' : 'flex' }}>
                        <span className="candy-emoji-large">{candyEmoji}</span>
                      </div>
                    </div>
                    <div className="candy-header">
                      <h3>{candy.name}</h3>
                      <span className={`candy-category category-${candy.category.toLowerCase().replace(/\s+/g, '-')}`}>
                        {candy.category}
                      </span>
                    </div>
                    <p className="candy-description">{candy.description}</p>
                    <div className="candy-footer">
                      <div className="candy-price">€{candy.pricePer100g.toFixed(2)} / 100g</div>
                      <button className="add-to-basket-btn" onClick={() => addToBasket(candy)}>
                        🛒 Toevoegen
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>

      {showCheckout && (
        <div className="checkout-modal">
          <div className="checkout-content">
            <h2>Afrekenen</h2>
            <form onSubmit={handleCheckout}>
              <div className="form-group">
                <label>Naam *</label>
                <input
                  type="text"
                  value={customerInfo.name}
                  onChange={(e) => setCustomerInfo({ ...customerInfo, name: e.target.value })}
                  required
                  placeholder="Jan Jansen"
                />
              </div>
              <div className="form-group">
                <label>Email *</label>
                <input
                  type="email"
                  value={customerInfo.email}
                  onChange={(e) => setCustomerInfo({ ...customerInfo, email: e.target.value })}
                  required
                  placeholder="jan@example.com"
                />
              </div>
              <div className="form-group">
                <label>Telefoon</label>
                <input
                  type="tel"
                  value={customerInfo.phone}
                  onChange={(e) => setCustomerInfo({ ...customerInfo, phone: e.target.value })}
                  placeholder="+31 6 12345678"
                />
              </div>
              <div className="form-group">
                <label>Adres</label>
                <input
                  type="text"
                  value={customerInfo.address}
                  onChange={(e) => setCustomerInfo({ ...customerInfo, address: e.target.value })}
                  placeholder="Straatnaam 123"
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Postcode</label>
                  <input
                    type="text"
                    value={customerInfo.postalCode}
                    onChange={(e) => setCustomerInfo({ ...customerInfo, postalCode: e.target.value })}
                    placeholder="1234AB"
                  />
                </div>
                <div className="form-group">
                  <label>Stad</label>
                  <input
                    type="text"
                    value={customerInfo.city}
                    onChange={(e) => setCustomerInfo({ ...customerInfo, city: e.target.value })}
                    placeholder="Amsterdam"
                  />
                </div>
              </div>
              <div className="checkout-total">
                <strong>Totaal: €{getTotalPrice().toFixed(2)}</strong>
              </div>
              <div className="checkout-actions">
                <button type="button" className="cancel-btn" onClick={() => setShowCheckout(false)}>
                  Annuleren
                </button>
                <button type="submit" className="submit-order-btn" disabled={loading}>
                  {loading ? 'Bestellen...' : 'Bestelling plaatsen'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
