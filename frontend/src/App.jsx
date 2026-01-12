import { useState } from 'react';
import { apiClient } from './api/client';
import './App.css';

// Professionele snoep categorieën met realistische producten
const SNOEP_CATEGORIEEN = {
  gummies: {
    naam: 'Gummies & Winegums',
    kleur: '#FF6B9D',
    icon: '🍬',
    producten: [
      { id: 'GUM001', naam: 'Haribo Goldbears Mix', prijs: 3.99, smaak: 'Aardbei, Sinaasappel, Citroen', kleur: '#FF4444', beschrijving: 'Klassieke fruitgummies, 200g' },
      { id: 'GUM002', naam: 'Winegums Assortiment', prijs: 4.49, smaak: 'Mixed Fruit', kleur: '#FFD700', beschrijving: 'Traditionele winegums, 250g' },
      { id: 'GUM003', naam: 'Fruittella Fruit Mix', prijs: 3.79, smaak: 'Appel, Druif, Kers', kleur: '#4CAF50', beschrijving: 'Zachte fruitgummies, 180g' },
      { id: 'GUM004', naam: 'Trolli Sour Worms', prijs: 4.99, smaak: 'Zuur Fruit', kleur: '#FF9800', beschrijving: 'Zure gummy worms, 220g' },
      { id: 'GUM005', naam: 'Katjes Fruity Mix', prijs: 3.29, smaak: 'Bosvruchten', kleur: '#2196F3', beschrijving: 'Vegan fruitgummies, 200g' },
    ],
  },
  chocolade: {
    naam: 'Chocolade & Pralines',
    kleur: '#8B4513',
    icon: '🍫',
    producten: [
      { id: 'CHO001', naam: 'Milka Melk Chocolade', prijs: 2.99, smaak: 'Melk', kleur: '#D2691E', beschrijving: 'Zachte melkchocolade, 100g' },
      { id: 'CHO002', naam: 'Lindt Excellence 70%', prijs: 4.99, smaak: 'Donker', kleur: '#654321', beschrijving: 'Pure chocolade, 100g' },
      { id: 'CHO003', naam: 'Ferrero Rocher', prijs: 8.99, smaak: 'Hazelnoot', kleur: '#FFF8DC', beschrijving: 'Pralines met hazelnoot, 200g' },
      { id: 'CHO004', naam: 'Tony\'s Chocolonely', prijs: 5.49, smaak: 'Caramel Zeezout', kleur: '#8B4513', beschrijving: 'Fairtrade chocolade, 180g' },
      { id: 'CHO005', naam: 'Côte d\'Or Melk', prijs: 3.49, smaak: 'Melk', kleur: '#CD853F', beschrijving: 'Belgische melkchocolade, 100g' },
    ],
  },
  hard: {
    naam: 'Hard Snoep & Drops',
    kleur: '#FFD700',
    icon: '🍭',
    producten: [
      { id: 'HAR001', naam: 'Fisherman\'s Friend Munt', prijs: 2.49, smaak: 'Munt', kleur: '#90EE90', beschrijving: 'Sterke muntdrops, 25g' },
      { id: 'HAR002', naam: 'Stroopwafels Drops', prijs: 2.99, smaak: 'Karamel', kleur: '#D2691E', beschrijving: 'Nederlandse stroopwafel drops, 150g' },
      { id: 'HAR003', naam: 'Lakrids Drops', prijs: 3.99, smaak: 'Zoethout', kleur: '#FFD700', beschrijving: 'Deense lakrids, 100g' },
      { id: 'HAR004', naam: 'Honing Drops', prijs: 2.79, smaak: 'Honing', kleur: '#FFC107', beschrijving: 'Natuurlijke honingdrops, 120g' },
      { id: 'HAR005', naam: 'Eucalyptus Drops', prijs: 2.29, smaak: 'Eucalyptus', kleur: '#E0E0E0', beschrijving: 'Verfrissende eucalyptus, 80g' },
    ],
  },
  zuur: {
    naam: 'Zure Snoepjes',
    kleur: '#FF1744',
    icon: '🍋',
    producten: [
      { id: 'ZUR001', naam: 'Sour Patch Kids', prijs: 3.99, smaak: 'Extreem Zuur', kleur: '#FF1744', beschrijving: 'Zure kids, 200g' },
      { id: 'ZUR002', naam: 'Toxic Waste', prijs: 4.49, smaak: 'Super Zuur', kleur: '#FF6B6B', beschrijving: 'Extreem zure snoepjes, 150g' },
      { id: 'ZUR003', naam: 'Zure Cola Flesjes', prijs: 2.99, smaak: 'Cola Zuur', kleur: '#3E2723', beschrijving: 'Zure cola snoepjes, 180g' },
      { id: 'ZUR004', naam: 'Warheads', prijs: 3.79, smaak: 'Extreem Zuur', kleur: '#C62828', beschrijving: 'Zure warheads, 100g' },
      { id: 'ZUR005', naam: 'Zure Appelschijfjes', prijs: 2.99, smaak: 'Appel Zuur', kleur: '#4CAF50', beschrijving: 'Zure appelsnoepjes, 150g' },
    ],
  },
  lollies: {
    naam: 'Lollies & Zuurstokken',
    kleur: '#E91E63',
    icon: '🍭',
    producten: [
      { id: 'LOL001', naam: 'Chupa Chups Aardbei', prijs: 1.99, smaak: 'Aardbei', kleur: '#F44336', beschrijving: 'Klassieke lolly, 15g' },
      { id: 'LOL002', naam: 'Tootsie Pop', prijs: 2.49, smaak: 'Bosbes', kleur: '#2196F3', beschrijving: 'Lolly met kauwcentrum, 20g' },
      { id: 'LOL003', naam: 'Ring Pop', prijs: 2.99, smaak: 'Citroen', kleur: '#FFEB3B', beschrijving: 'Ringvormige lolly, 18g' },
      { id: 'LOL004', naam: 'Zuurstok Rood-Wit', prijs: 1.49, smaak: 'Pepermunt', kleur: '#4CAF50', beschrijving: 'Traditionele zuurstok, 50g' },
      { id: 'LOL005', naam: 'Regenboog Lolly', prijs: 2.79, smaak: 'Mixed Fruit', kleur: '#E91E63', beschrijving: 'Grote regenboog lolly, 30g' },
    ],
  },
};

function App() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [activeCategorie, setActiveCategorie] = useState('gummies');
  const [cart, setCart] = useState([]);
  const [showCart, setShowCart] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  
  const [customerForm, setCustomerForm] = useState({
    name: '',
    email: '',
    phone: '',
  });

  const showMessage = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const addToCart = (product) => {
    const existingItem = cart.find(item => item.productId === product.id);
    
    if (existingItem) {
      setCart(cart.map(item =>
        item.productId === product.id
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      setCart([...cart, {
        productId: product.id,
        naam: product.naam,
        prijs: product.prijs,
        quantity: 1,
        smaak: product.smaak,
        kleur: product.kleur,
        beschrijving: product.beschrijving,
      }]);
    }
    showMessage('success', `${product.naam} toegevoegd aan winkelmand`);
  };

  const removeFromCart = (productId) => {
    setCart(cart.filter(item => item.productId !== productId));
  };

  const updateQuantity = (productId, quantity) => {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }
    setCart(cart.map(item =>
      item.productId === productId
        ? { ...item, quantity }
        : item
    ));
  };

  const getTotalPrice = () => {
    return cart.reduce((total, item) => total + item.prijs * item.quantity, 0);
  };

  const getCartItemCount = () => {
    return cart.reduce((total, item) => total + item.quantity, 0);
  };

  const handleCheckout = async (e) => {
    e.preventDefault();
    
    if (cart.length === 0) {
      showMessage('error', 'Je winkelmand is leeg');
      return;
    }

    if (!customerForm.name || !customerForm.email) {
      showMessage('error', 'Vul alle verplichte velden in');
      return;
    }

    setLoading(true);
    try {
      // Genereer automatisch klant ID
      const customerId = `CUST-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
      
      // Eerst customer aanmaken met automatisch gegenereerd ID
      const customer = {
        id: customerId,
        name: customerForm.name,
        email: customerForm.email,
        phone: customerForm.phone || '',
      };
      
      await apiClient.createCustomer(customer);

      // Dan order aanmaken
      const orderId = `ORD-${Date.now()}`;
      const order = {
        id: orderId,
        customerId: customerId,
        amount: getTotalPrice(),
        currency: 'EUR',
        items: cart.map(item => ({
          productId: item.productId,
          quantity: item.quantity,
          price: item.prijs,
        })),
      };

      const response = await apiClient.createOrder(order);
      
      showMessage('success', `Bestelling succesvol geplaatst! Ordernummer: ${orderId}`);
      
      // Reset forms en cart
      setCart([]);
      setCustomerForm({ name: '', email: '', phone: '' });
      setShowCheckout(false);
      setShowCart(false);
    } catch (error) {
      showMessage('error', error.message || 'Bestelling mislukt. Probeer het opnieuw.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <div className="logo-section">
            <h1>Snoepwinkel Deluxe</h1>
            <p className="tagline">Premium snoep & chocolade</p>
          </div>
          <button 
            className="cart-button"
            onClick={() => setShowCart(!showCart)}
          >
            <span className="cart-icon">🛒</span>
            <span className="cart-text">Winkelmand</span>
            {getCartItemCount() > 0 && (
              <span className="cart-badge">{getCartItemCount()}</span>
            )}
          </button>
        </div>
      </header>

      {message && (
        <div className={`message ${message.type}`}>
          {message.text}
        </div>
      )}

      {showCart && (
        <div className="cart-overlay" onClick={() => setShowCart(false)}>
          <div className="cart-panel" onClick={(e) => e.stopPropagation()}>
            <div className="cart-header">
              <h2>Winkelmand</h2>
              <button className="close-btn" onClick={() => setShowCart(false)}>✕</button>
            </div>
            {cart.length === 0 ? (
              <div className="empty-cart">
                <p>Je winkelmand is leeg</p>
                <button className="continue-shopping" onClick={() => setShowCart(false)}>
                  Verder winkelen
                </button>
              </div>
            ) : (
              <>
                <div className="cart-items">
                  {cart.map((item) => (
                    <div key={item.productId} className="cart-item">
                      <div 
                        className="cart-item-color" 
                        style={{ backgroundColor: item.kleur }}
                      />
                      <div className="cart-item-info">
                        <h4>{item.naam}</h4>
                        <p className="cart-item-desc">{item.beschrijving}</p>
                        <p className="cart-item-price">€{item.prijs.toFixed(2)} per stuk</p>
                      </div>
                      <div className="cart-item-controls">
                        <button onClick={() => updateQuantity(item.productId, item.quantity - 1)}>
                          −
                        </button>
                        <span>{item.quantity}</span>
                        <button onClick={() => updateQuantity(item.productId, item.quantity + 1)}>
                          +
                        </button>
                      </div>
                      <div className="cart-item-total">
                        €{(item.prijs * item.quantity).toFixed(2)}
                      </div>
                      <button 
                        className="remove-btn"
                        onClick={() => removeFromCart(item.productId)}
                        title="Verwijderen"
                      >
                        🗑️
                      </button>
                    </div>
                  ))}
                </div>
                <div className="cart-footer">
                  <div className="cart-total">
                    <span>Totaal:</span>
                    <strong>€{getTotalPrice().toFixed(2)}</strong>
                  </div>
                  <button 
                    className="checkout-btn"
                    onClick={() => {
                      setShowCheckout(true);
                      setShowCart(false);
                    }}
                  >
                    Naar afrekenen
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showCheckout && (
        <div className="checkout-overlay" onClick={() => setShowCheckout(false)}>
          <div className="checkout-panel" onClick={(e) => e.stopPropagation()}>
            <div className="checkout-header">
              <h2>Afrekenen</h2>
              <button className="close-btn" onClick={() => setShowCheckout(false)}>✕</button>
            </div>
            <form onSubmit={handleCheckout}>
              <div className="checkout-section">
                <h3>Persoonlijke gegevens</h3>
                <div className="form-group">
                  <label>Volledige naam *</label>
                  <input
                    type="text"
                    value={customerForm.name}
                    onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                    placeholder="Jan Jansen"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>E-mailadres *</label>
                  <input
                    type="email"
                    value={customerForm.email}
                    onChange={(e) => setCustomerForm({ ...customerForm, email: e.target.value })}
                    placeholder="jan@example.com"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Telefoonnummer</label>
                  <input
                    type="tel"
                    value={customerForm.phone}
                    onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                    placeholder="+31 6 12345678"
                  />
                </div>
              </div>
              
              <div className="checkout-summary">
                <h3>Bestelling overzicht</h3>
                <div className="checkout-items">
                  {cart.map((item) => (
                    <div key={item.productId} className="checkout-item">
                      <div className="checkout-item-info">
                        <span className="checkout-item-name">{item.naam}</span>
                        <span className="checkout-item-qty">x {item.quantity}</span>
                      </div>
                      <span className="checkout-item-price">€{(item.prijs * item.quantity).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <div className="checkout-total">
                  <span>Totaalbedrag:</span>
                  <strong>€{getTotalPrice().toFixed(2)}</strong>
                </div>
              </div>
              
              <button type="submit" disabled={loading} className="submit-btn">
                {loading ? 'Bestelling wordt verwerkt...' : 'Bestelling plaatsen'}
              </button>
            </form>
          </div>
        </div>
      )}

      <nav className="categories">
        {Object.entries(SNOEP_CATEGORIEEN).map(([key, categorie]) => (
          <button
            key={key}
            className={`category-btn ${activeCategorie === key ? 'active' : ''}`}
            onClick={() => setActiveCategorie(key)}
            style={{
              backgroundColor: activeCategorie === key ? categorie.kleur : '#f8f9fa',
              color: activeCategorie === key ? 'white' : '#495057',
              border: activeCategorie === key ? 'none' : '2px solid #dee2e6',
            }}
          >
            <span className="category-icon">{categorie.icon}</span>
            <span>{categorie.naam}</span>
          </button>
        ))}
      </nav>

      <main className="main-content">
        <div className="category-header">
          <h2>{SNOEP_CATEGORIEEN[activeCategorie].naam}</h2>
          <p className="category-count">{SNOEP_CATEGORIEEN[activeCategorie].producten.length} producten</p>
        </div>
        <div className="products-grid">
          {SNOEP_CATEGORIEEN[activeCategorie].producten.map((product) => (
            <div key={product.id} className="product-card">
              <div 
                className="product-color-circle"
                style={{ backgroundColor: product.kleur }}
              >
                {SNOEP_CATEGORIEEN[activeCategorie].icon}
              </div>
              <div className="product-info">
                <h3>{product.naam}</h3>
                <p className="product-smaak">{product.smaak}</p>
                <p className="product-desc">{product.beschrijving}</p>
                <div className="product-footer">
                  <p className="product-prijs">€{product.prijs.toFixed(2)}</p>
                  <button
                    className="add-to-cart-btn"
                    onClick={() => addToCart(product)}
                  >
                    In winkelmand
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>

      <footer className="footer">
        <div className="footer-content">
          <p>&copy; 2024 Snoepwinkel Deluxe. Alle rechten voorbehouden.</p>
          <p className="footer-links">
            <a href="#privacy">Privacy</a> | 
            <a href="#voorwaarden">Algemene voorwaarden</a> | 
            <a href="#contact">Contact</a>
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
