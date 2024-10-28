const redis = require('redis');
const request = require('request');
const bodyParser = require('body-parser');
const express = require('express');
const pino = require('pino');
const expPino = require('express-pino-logger');
const promClient = require('prom-client');
const { createClient } = require('redis');

// Initialize Instana if the agent is available
const instanaAvailable = process.env.INSTANA_AGENT_AVAILABLE === 'true';
let instana;

if (instanaAvailable) {
    instana = require('@instana/collector')({
        agentHost: process.env.INSTANA_AGENT_HOST || 'localhost',
        tracing: { enabled: true }
    });
    console.log("Instana initialized.");
} else {
    console.log("Instana not initialized as agent is unavailable.");
}

// Prometheus setup
const Registry = promClient.Registry;
const register = new Registry();
const counter = new promClient.Counter({
    name: 'items_added',
    help: 'Running count of items added to cart',
    registers: [register]
});

// Logger setup
const logger = pino({
    level: 'info',
    prettyPrint: false,
    useLevelLabels: true
});
const expLogger = expPino({ logger });

const app = express();
app.use(expLogger);

// CORS headers
app.use((req, res, next) => {
    res.set('Timing-Allow-Origin', '*');
    res.set('Access-Control-Allow-Origin', '*');
    next();
});

// Add datacenter tag to Instana spans
app.use((req, res, next) => {
    const dcs = ["asia-northeast2", "asia-south1", "europe-west3", "us-east1", "us-west1"];
    
    if (instana) {
        const span = instana.currentSpan();
        if (span) {
            span.annotate('custom.sdk.tags.datacenter', dcs[Math.floor(Math.random() * dcs.length)]);
        }
    }
    next();
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ app: 'OK', redis: redisConnected });
});

// Prometheus metrics endpoint
app.get('/metrics', (req, res) => {
    res.header('Content-Type', 'text/plain');
    res.send(register.metrics());
});

// Redis setup
const redisHost = process.env.REDIS_HOST || 'redis';
const redisClient = createClient({ host: redisHost });
let redisConnected = false;

redisClient.on('connect', () => {
    redisConnected = true;
    console.log('Redis connected');
});
redisClient.on('error', (err) => {
    redisConnected = false;
    console.log('Redis error:', err);
});

// Get cart by ID
app.get('/cart/:id', (req, res) => {
    if (!redisConnected) {
        return res.status(500).send('Redis is not connected');
    }

    redisClient.get(req.params.id, (err, data) => {
        if (err) {
            req.log.error('ERROR', err);
            res.status(500).send(err);
        } else if (data == null) {
            res.status(404).send('Cart not found');
        } else {
            res.json(JSON.parse(data));
        }
    });
});

// Delete cart by ID
app.delete('/cart/:id', (req, res) => {
    if (!redisConnected) {
        return res.status(500).send('Redis is not connected');
    }

    redisClient.del(req.params.id, (err, data) => {
        if (err) {
            req.log.error('ERROR', err);
            res.status(500).send(err);
        } else if (data === 1) {
            res.send('OK');
        } else {
            res.status(404).send('Cart not found');
        }
    });
});

// Rename cart
app.get('/rename/:from/:to', (req, res) => {
    if (!redisConnected) {
        return res.status(500).send('Redis is not connected');
    }

    redisClient.get(req.params.from, (err, data) => {
        if (err) {
            req.log.error('ERROR', err);
            res.status(500).send(err);
        } else if (data == null) {
            res.status(404).send('Cart not found');
        } else {
            const cart = JSON.parse(data);
            saveCart(req.params.to, cart).then(() => {
                res.json(cart);
            }).catch((err) => {
                req.log.error(err);
                res.status(500).send(err);
            });
        }
    });
});

// Update/create cart
app.get('/add/:id/:sku/:qty', (req, res) => {
    if (!redisConnected) {
        return res.status(500).send('Redis is not connected');
    }

    const qty = parseInt(req.params.qty);
    if (isNaN(qty) || qty < 1) {
        req.log.warn('Invalid quantity');
        return res.status(400).send('Quantity must be a number greater than zero');
    }

    getProduct(req.params.sku).then((product) => {
        if (!product) {
            return res.status(404).send('Product not found');
        }
        if (product.instock === 0) {
            return res.status(404).send('Out of stock');
        }

        redisClient.get(req.params.id, (err, data) => {
            if (err) {
                req.log.error('ERROR', err);
                res.status(500).send(err);
            } else {
                let cart = data ? JSON.parse(data) : { total: 0, tax: 0, items: [] };
                const item = { qty, sku: req.params.sku, name: product.name, price: product.price, subtotal: qty * product.price };
                cart.items = mergeList(cart.items, item, qty);
                cart.total = calcTotal(cart.items);
                cart.tax = calcTax(cart.total);

                saveCart(req.params.id, cart).then(() => {
                    counter.inc(qty);
                    res.json(cart);
                }).catch((err) => {
                    req.log.error(err);
                    res.status(500).send(err);
                });
            }
        });
    }).catch((err) => {
        req.log.error(err);
        res.status(500).send(err);
    });
});

// Update quantity
app.get('/update/:id/:sku/:qty', (req, res) => {
    if (!redisConnected) {
        return res.status(500).send('Redis is not connected');
    }

    const qty = parseInt(req.params.qty);
    if (isNaN(qty) || qty < 0) {
        req.log.warn('Invalid quantity');
        return res.status(400).send('Quantity must be a non-negative number');
    }

    redisClient.get(req.params.id, (err, data) => {
        if (err) {
            req.log.error('ERROR', err);
            res.status(500).send(err);
        } else if (data == null) {
            res.status(404).send('Cart not found');
        } else {
            const cart = JSON.parse(data);
            const idx = cart.items.findIndex(item => item.sku === req.params.sku);
            if (idx === -1) {
                res.status(404).send('Item not in cart');
            } else {
                if (qty === 0) {
                    cart.items.splice(idx, 1);
                } else {
                    cart.items[idx].qty = qty;
                    cart.items[idx].subtotal = cart.items[idx].price * qty;
                }
                cart.total = calcTotal(cart.items);
                cart.tax = calcTax(cart.total);
                saveCart(req.params.id, cart).then(() => {
                    res.json(cart);
                }).catch((err) => {
                    req.log.error(err);
                    res.status(500).send(err);
                });
            }
        }
    });
});

// Add shipping
app.post('/shipping/:id', (req, res) => {
    if (!redisConnected) {
        return res.status(500).send('Redis is not connected');
    }

    const shipping = req.body;
    if (!shipping.distance || !shipping.cost || !shipping.location) {
        req.log.warn('Missing shipping data', shipping);
        return res.status(400).send('Missing shipping data');
    }

    redisClient.get(req.params.id, (err, data) => {
        if (err) {
            req.log.error('ERROR', err);
            res.status(500).send(err);
        } else if (data == null) {
            res.status(404).send('Cart not found');
        } else {
            const cart = JSON.parse(data);
            if (!cart.shipping) {
                cart.shipping = shipping;
            } else {
                cart.shipping.cost += shipping.cost;
                cart.shipping.distance += shipping.distance;
            }
            cart.total += cart.shipping.cost;
            saveCart(req.params.id, cart).then(() => {
                res.json(cart);
            }).catch((err) => {
                req.log.error(err);
                res.status(500).send(err);
            });
        }
    });
});

// Save cart
function saveCart(id, cart) {
    return new Promise((resolve, reject) => {
        redisClient.set(id, JSON.stringify(cart), (err) => {
            if (err) {
                return reject(err);
            }
            resolve();
        });
    });
}

// Get product from catalogue
function getProduct(sku) {
    return new Promise((resolve, reject) => {
        request(`http://catalogue:8080/products/${sku}`, (error, response, body) => {
            if (error) {
                return reject(error);
            }
            if (response.statusCode !== 200) {
                return resolve(null);
            }
            resolve(JSON.parse(body));
        });
    });
}

// Merge item list
function mergeList(list, item, qty) {
    const idx = list.findIndex(existingItem => existingItem.sku === item.sku);
    if (idx !== -1) {
        list[idx].qty += qty;
        list[idx].subtotal = list[idx].price * list[idx].qty;
    } else {
        list.push(item);
    }
    return list;
}

// Calculate total
function calcTotal(items) {
    return items.reduce((sum, item) => sum + item.subtotal, 0);
}

// Calculate tax
function calcTax(total) {
    return total * 0.05; // Assuming a 5% tax rate
}

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
