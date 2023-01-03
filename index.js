const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

// middle wares
app.use(cors());
app.use(express.json());

function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'Unauthorized access' });
    }
    const token = authHeader.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'Forbidden access' });
        }
        req.decoded = decoded;
        next();
    })
}


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.i9w8jvi.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

async function run() {
    try {
        const appointmentOptionCollection = client.db("doctorsPortal").collection("appointmentOptions");
        const bookingCollection = client.db("doctorsPortal").collection("bookings");
        const userCollection = client.db("doctorsPortal").collection("users");
        const doctorCollection = client.db("doctorsPortal").collection("doctors");
        const paymentCollection = client.db("doctorsPortal").collection("payments");

        // middleware verifyAdmin
        async function verifyAdmin(req, res, next) {
            const decodedEmail = req.decoded.email;
            const query = { email: decodedEmail };
            const user = await userCollection.findOne(query);
            if (user?.role !== 'admin') {
                return res.status(403).send({ message: 'Forbidden access' });
            }
            next();
        }

        // creating jwt token
        app.get('/jwt', async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1d' });
                return res.send({ accessToken: token });
            }
            res.status(403).send({ accessToken: '' });
        });

        /* ---------------
            PAYMENT API
        -----------------*/
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const { price } = req.body;
            const amount = price * 100; // converted to cents

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                "payment_method_types": [
                    "card"
                ],
            })

            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });

        // add payments info to DB
        app.post('/payments', verifyJWT, async (req, res) => {
            const payment = req.body;
            const result = await paymentCollection.insertOne(payment);
            // update in bookingCollection
            const id = payment.bookingId;
            const filter = {_id: ObjectId(id)};
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }
            const updatedResult = await bookingCollection.updateOne(filter, updatedDoc);
            /* --------------------------------------------------- */
            res.send(result);
        });

        /* -----------------------
          Appointment Options API
        ----------------------- */

        // use aggregate to query multiple collection and merge data
        app.get('/appointmentOptions', async (req, res) => {
            const date = req.query.date;
            const query = {};
            const cursor = appointmentOptionCollection.find(query);
            const options = await cursor.toArray();

            // get the booking of the provided date
            const bookingQuery = { appointmentDate: date };
            const alreadyBooked = await bookingCollection.find(bookingQuery).toArray();
            options.forEach(option => {

                // booking based on an option
                const optionBooked = alreadyBooked.filter(book => book.treatment === option.name);
                // slots booked for an option
                const bookedSlots = optionBooked.map(book => book.slot);
                // remaining slots for an option
                const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot));

                // console.log(date, option.name, remainingSlots.length)
                option.slots = remainingSlots;
            })
            res.send(options);
        });

        /* -----------
         Bookings API
        ------------- */
        app.get('/bookings', verifyJWT, async (req, res) => {
            const decoded = req.decoded;
            const email = req.query.email;

            if (decoded.email !== email) {
                return res.status(403).send({ message: 'Forbidden access' });
            }

            query = {
                email: email
            }
            const cursor = bookingCollection.find(query);
            const bookings = await cursor.toArray();
            res.send(bookings);
        });

        app.get('/bookings/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const booking = await bookingCollection.findOne(query);
            res.send(booking);
        });

        app.post('/bookings', verifyJWT, async (req, res) => {
            const booking = req.body;
            const query = {
                appointmentDate: booking.appointmentDate,
                email: booking.email,
                treatment: booking.treatment
            }
            const alreadyBooked = await bookingCollection.find(query).toArray();
            if (alreadyBooked.length) {
                const message = `You already have an appointment on ${booking.appointmentDate}`;
                return res.send({ acknowledged: false, message });
            }

            const result = await bookingCollection.insertOne(booking);
            res.send(result);
        });

        /* ----------
          Users API
        ---------- */
        // get all the users (only for admins)
        app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
            console.log('admin proven');
            const query = {};
            const cursor = userCollection.find(query);
            const users = await cursor.toArray();
            res.send(users);
        });

        // useAdmin hook api (sending isAdmin info)
        app.get('/users/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const query = { email };
            const user = await userCollection.findOne(query);
            res.send({ isAdmin: user?.role === 'admin' });
        });

        // Saving user to DB
        app.post('/users', async (req, res) => {
            const user = req.body;
            const result = await userCollection.insertOne(user);
            res.send(result);
        });

        // Make Admin api
        app.put('/users/admin/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const options = { upsert: true };
            const updatedDoc = {
                $set: {
                    role: "admin"
                }
            }
            const result = await userCollection.updateOne(filter, updatedDoc, options);
            res.send(result);
        });

        // temporary: add price field to appointmentOptions
        // app.get('/addPrice', async (req, res) => {
        //     const filter = {};
        //     const options = {upsert: true};
        //     const updatedDoc = {
        //         $set: {
        //             price: 99
        //         }
        //     }
        //     const result = await appointmentOptionCollection.updateMany(filter, updatedDoc, options);
        //     res.send(result);
        // });

        /* -----------
          Doctors API
        ------------ */
        app.get('/doctorSpecialties', async (req, res) => {
            const query = {}
            const result = await appointmentOptionCollection.find(query).project({ name: 1 }).toArray();
            res.send(result);
        });

        app.get('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
            const query = {};
            const cursor = doctorCollection.find(query);
            const doctors = await cursor.toArray();
            res.send(doctors);
        });

        app.post('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorCollection.insertOne(doctor);
            res.send(result);
        });

        app.delete('/doctors/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = await doctorCollection.deleteOne(query);
            res.send(result);
        });
    }
    finally {

    }
}

run().catch(console.dir);

app.get('/', (req, res) => {
    res.send("Doctors portal server running");
});

app.listen(port, () => {
    console.log(`doctors-portal server running on ${port}`);
})