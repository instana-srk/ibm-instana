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

const { MongoClient, ObjectId } = require('mongodb');
const bodyParser = require('body-parser');
const express = require('express');
const pino = require('pino');
const expPino = require('express-pino-logger');

const logger = pino({ level: 'info', prettyPrint: false, useLevelLabels: true });
const expLogger = expPino({ logger: logger });

// MongoDB
let db;
let collection;
let mongoConnected = false;

const app = express();

app.use(expLogger);
app.use((req, res, next) => {
    res.set('Timing-Allow-Origin', '*');
    res.set('Access-Control-Allow-Origin', '*');
    next();
});

if (instanaAvailable) {
    app.use((req, res, next) => {
        let dcs = [
            "asia-northeast2",
            "asia-south1",
            "europe-west3",
            "us-east1",
            "us-west1"
        ];
        let span = instana.currentSpan();
        span.annotate('custom.sdk.tags.datacenter', dcs[Math.floor(Math.random() * dcs.length)]);
        next();
    });
}

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.get('/health', (req, res) => {
    const stat = {
        app: 'OK',
        mongo: mongoConnected
    };
    res.json(stat);
});

// All products
app.get('/products', (req, res) => {
    if (mongoConnected) {
        collection.find({}).toArray()
            .then(products => res.json(products))
            .catch(error => handleError(error, req, res));
    } else {
        sendDbError(req, res);
    }
});

// Product by SKU
app.get('/product/:sku', (req, res) => {
    if (mongoConnected) {
        const delay = process.env.GO_SLOW || 0;
        setTimeout(() => {
            collection.findOne({ sku: req.params.sku })
                .then(product => product ? res.json(product) : res.status(404).send('SKU not found'))
                .catch(error => handleError(error, req, res));
        }, delay);
    } else {
        sendDbError(req, res);
    }
});

// Products in a category
app.get('/products/:cat', (req, res) => {
    if (mongoConnected) {
        collection.find({ categories: req.params.cat }).sort({ name: 1 }).toArray()
            .then(products => res.json(products.length ? products : 'No products for ' + req.params.cat))
            .catch(error => handleError(error, req, res));
    } else {
        sendDbError(req, res);
    }
});

// All categories
app.get('/categories', (req, res) => {
    if (mongoConnected) {
        collection.distinct('categories')
            .then(categories => res.json(categories))
            .catch(error => handleError(error, req, res));
    } else {
        sendDbError(req, res);
    }
});

// Search name and description
app.get('/search/:text', (req, res) => {
    if (mongoConnected) {
        collection.find({ '$text': { '$search': req.params.text } }).toArray()
            .then(hits => res.json(hits))
            .catch(error => handleError(error, req, res));
    } else {
        sendDbError(req, res);
    }
});

function handleError(error, req, res) {
    req.log.error('ERROR', error);
    res.status(500).send(error);
}

function sendDbError(req, res) {
    req.log.error('Database not available');
    res.status(500).send('Database not available');
}

// Set up Mongo
async function mongoConnect() {
    try {
        const mongoURL = process.env.MONGO_URL || 'mongodb://mongodb:27017/catalogue';
        const client = await MongoClient.connect(mongoURL); // Removed deprecated options
        db = client.db('catalogue');
        collection = db.collection('products');
        mongoConnected = true;
        logger.info('MongoDB connected');
    } catch (error) {
        mongoConnected = false;
        logger.error('ERROR', error);
        setTimeout(mongoLoop, 2000);
    }
}

// MongoDB connection retry loop
function mongoLoop() {
    mongoConnect().catch(error => {
        logger.error('ERROR', error);
        setTimeout(mongoLoop, 2000);
    });
}

mongoLoop();

// Start server
const port = process.env.CATALOGUE_SERVER_PORT || '8080';
app.listen(port, () => {
    logger.info('Started on port', port);
});
