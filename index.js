const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// middle wares
app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.i9w8jvi.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

async function run() {
    try {
        const appointmentOptionCollection = client.db("doctorsPortal").collection("appointmentOptions");

        const bookingCollection = client.db("doctorsPortal").collection("bookings");

        // use aggregate to query multiple collection and merge data
        app.get('/appointmentOptions', async (req, res) => {
            const date = req.query.date;
            const query = {};
            const cursor = appointmentOptionCollection.find(query);
            const options = await cursor.toArray();
            // get the booking of the provided day
            const bookingQuery = {appointmentDate: date};
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

        app.post('/bookings', async (req, res) => {
            const booking = req.body;
            console.log(booking);
            const query = {
                appointmentDate: booking.appointmentDate,
                treatment: booking.treatment,
                email: booking.email
            }
            const alreadyBooked = await bookingCollection.find(query).toArray();
            if (alreadyBooked.length) {
                const message = `You already have an appointment on ${booking.appointmentDate}`;
                return res.send({acknowledged: false, message});
            }

            const result = await bookingCollection.insertOne(booking);
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