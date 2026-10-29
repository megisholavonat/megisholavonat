import AnalyticsConsentSwitch from "@/components/settings/AnalyticsConsentSwitch";

const CONTACT_EMAIL = "hello@megisholavonat.info";

function External({ href, children }: { href: string; children: string }) {
    return (
        <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
        </a>
    );
}

export default function PrivacyContentEn() {
    return (
        <>
            <p>
                This notice explains what data{" "}
                <strong>Mégis hol a vonat?</strong> (the megisholavonat.info
                website and the MHaV app for iPhone and Android) processes, why
                and for how long, who else receives it, and what your rights
                are. There is no sign-up: we never ask for your name, email
                address or phone number. It is a free hobby project. We count
                visitors for everyone, but we only collect detailed statistics
                tied to an ID if you agree to it.
            </p>

            <h2>Who is responsible for your data?</h2>
            <p>
                The site and the app are run by Martin Reicher and Márk Gyóni as
                joint controllers. Contact:{" "}
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
            </p>
            <p>
                The project is open source; its code is available on{" "}
                <External href="https://github.com/megisholavonat/megisholavonat">
                    GitHub
                </External>
                .
            </p>

            <h2>At a glance</h2>
            <table>
                <thead>
                    <tr>
                        <th>What</th>
                        <th>Why</th>
                        <th>How long</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>IP address, browser details, requested address</td>
                        <td>Serving the site and the app, security</td>
                        <td>
                            Rotating server logs; rate limiting: at most 1 hour
                        </td>
                    </tr>
                    <tr>
                        <td>Your location</td>
                        <td>Showing you on the map</td>
                        <td>Not stored, never leaves your device</td>
                    </tr>
                    <tr>
                        <td>
                            Settings, recent stations, followed trains (web)
                        </td>
                        <td>Remembering your choices</td>
                        <td>On your device until you delete them</td>
                    </tr>
                    <tr>
                        <td>
                            App device ID, push token, followed trains, alert
                            state
                        </td>
                        <td>Sending the alerts you asked for</td>
                        <td>
                            Until you unfollow; everything is deleted after 180
                            days without use
                        </td>
                    </tr>
                    <tr>
                        <td>Anonymous usage statistics</td>
                        <td>Counting visitors and feature use</td>
                        <td>At PostHog, see below</td>
                    </tr>
                    <tr>
                        <td>Usage statistics with a random ID</td>
                        <td>Only with your consent: improving the service</td>
                        <td>At PostHog, until you withdraw consent</td>
                    </tr>
                </tbody>
            </table>

            <h2>Serving the site and the app</h2>
            <p>
                When you open the site or the app, your device connects to our
                server, which receives your IP address, your browser or app
                details (user agent) and the page or data you requested. This is
                needed to send you the site and the train data at all, and to
                keep the service secure. Requests first pass through
                Cloudflare&apos;s network, which protects and speeds up the
                service; Cloudflare passes your IP address on to us.
            </p>
            <ul>
                <li>
                    <strong>Legal basis:</strong> legitimate interest (GDPR Art.
                    6(1)(f)): running and protecting the service.
                </li>
                <li>
                    <strong>Retention:</strong> server logs are not archived or
                    collected centrally; they are overwritten automatically as
                    new entries arrive. To limit abuse, registering an app
                    device is rate limited by IP address (for IPv6, by its
                    network prefix); this counter is deleted after at most one
                    hour.
                </li>
                <li>
                    <strong>Processors:</strong> a hosting provider in London,
                    United Kingdom, and Cloudflare.
                </li>
            </ul>

            <h2>Train data, statistics and journey planning</h2>
            <p>
                Train positions, delays, station boards and the punctuality
                statistics are about trains, not about you: we collect them from
                MÁV&apos;s public data and store them without any link to our
                users.
            </p>
            <p>
                When you plan a journey, your device sends the two stations and
                the chosen time to our server. Our server then asks MÁV&apos;s
                journey planner on its own behalf, so MÁV receives only the
                stations and the time, not your IP address or anything about
                you. We keep the result for one minute so that identical
                searches are faster; it is not linked to you.
            </p>
            <p>
                When you share a train or a station, the preview image is made
                by our server from train data only; no personal data is used.
            </p>

            <h2>The map</h2>
            <p>
                To show the map, the website and the app download map images
                (tiles) directly from the sources below. These servers therefore
                also receive your IP address and which part of the map you are
                looking at.
            </p>
            <ul>
                <li>
                    <strong>Base map:</strong>{" "}
                    <External href="https://openfreemap.org/">
                        OpenFreeMap
                    </External>{" "}
                    (tiles.openfreemap.org).
                </li>
                <li>
                    <strong>Railway layer:</strong> our own tile cache
                    (tc.megisholavonat.info), which stores tiles from{" "}
                    <External href="https://www.openrailwaymap.org/">
                        OpenRailwayMap
                    </External>
                    , so OpenRailwayMap does not see your IP address.
                </li>
            </ul>
            <p>
                <strong>Legal basis:</strong> legitimate interest (GDPR Art.
                6(1)(f)): the map cannot be shown otherwise. Fonts are served
                from our own server, not from Google.
            </p>

            <h2>Your location</h2>
            <p>
                If you tap the location button (or have already allowed it),
                your browser or phone provides your position. We use it{" "}
                <strong>only on your device</strong> to show where you are on
                the map. Your position is never sent to us or anyone else, and
                it is not stored. You can revoke the permission at any time in
                your browser or phone settings.
            </p>

            <h2>What we store on your device</h2>
            <p>
                On the website we use a single cookie: the{" "}
                <code>NEXT_LOCALE</code> session cookie remembers your language
                and is deleted when you close your browser. Everything else is
                kept in your browser&apos;s local storage (localStorage) and
                never reaches us:
            </p>
            <ul>
                <li>
                    <code>mhav.settings.*</code>: map settings (e.g. station
                    names, vehicle types, animation);
                </li>
                <li>
                    <code>theme</code>: your chosen theme (light, dark or
                    system);
                </li>
                <li>
                    <code>mhav.recentStations</code>: the stations you searched
                    for recently;
                </li>
                <li>
                    <code>mhav.follows</code>: the trains you follow on the
                    website. These stay in your browser only; the website does
                    not send alerts;
                </li>
                <li>
                    <code>mhav.consent.analytics</code>: whether you allowed
                    detailed statistics, and when you decided.
                </li>
            </ul>
            <p>
                For the current session only (until you close the tab), we also
                keep the <code>mhav.consent.prompt</code> key in session storage
                (sessionStorage), so you don&apos;t have to wait for the
                statistics question again after a reload.
            </p>
            <p>
                The app keeps your settings (including your statistics choice)
                and the trains you follow in files on your phone. If you follow
                a train, it also stores its device credential (see below) in the
                iPhone Keychain or the Android Keystore. If you accept
                statistics, it also keeps a random statistics ID in a file.
            </p>
            <p>
                These are needed for the site and the app to work and to
                remember your choices, so we do not ask for separate consent.
                You can remove them at any time with{" "}
                <strong>Clear saved data</strong> in the website&apos;s settings
                or <strong>Delete my data</strong> in the app&apos;s settings,
                by clearing your browser data or by deleting the app.
            </p>

            <h2>Following trains and alerts in the app</h2>
            <p>
                In the app you can follow a train once or as a regular commute,
                and get a notification if it is late, its platform changes or
                the train before it is running late. For this our server has to
                know what to watch and where to send the alerts. There is no
                account: when you first follow a train, the app registers an
                anonymous device with our server. We store:
            </p>
            <ul>
                <li>
                    <strong>the device:</strong> a random ID, a hash of its
                    secret key (the key itself stays in your phone&apos;s
                    Keychain or Keystore), the platform (iOS or Android), the
                    app&apos;s language (for the language of the alerts), when
                    it was created and the day it last contacted us;
                </li>
                <li>
                    <strong>the trains you follow:</strong> the train number,
                    the date (for a single trip) or the weekdays (for a
                    commute), your boarding and alighting stations, and your
                    alert settings (delay threshold, platform changes);
                </li>
                <li>
                    <strong>the push token:</strong> if you allow notifications,
                    the app&apos;s push address (an Expo push token), together
                    with whether recent deliveries succeeded;
                </li>
                <li>
                    <strong>alert state:</strong> the last delay and platform we
                    notified you about and when, so you don&apos;t get the same
                    alert twice.
                </li>
            </ul>
            <p>
                On iPhone, if you show a followed train as a Live Activity, the
                app also sends that activity&apos;s own push token to our
                server, and we send the updates to it through Apple&apos;s push
                service.
            </p>
            <p>
                The alerts are sent through Expo&apos;s push service, which
                passes them on to Apple (APNs) for iPhones and to Google
                (Firebase Cloud Messaging) for Android phones. They receive the
                push token and the content of the alert: the train, its delay or
                platform, and the IDs the app needs to open the right train.
            </p>
            <ul>
                <li>
                    <strong>Legal basis:</strong> providing the service you ask
                    for (GDPR Art. 6(1)(b)). Notifications are sent only if you
                    allow them on your phone.
                </li>
                <li>
                    <strong>Retention:</strong>
                    <ul>
                        <li>
                            if you unfollow a train, we delete it and its alert
                            state immediately;
                        </li>
                        <li>
                            a single trip is deleted automatically two days
                            after its date, alert state two days after the day
                            it is about;
                        </li>
                        <li>
                            a Live Activity&apos;s token is deleted when the
                            activity ends, at the latest after 12 hours;
                        </li>
                        <li>
                            a push token is deleted as soon as Apple or Google
                            reports it invalid (e.g. after you delete the app),
                            or after repeated failed deliveries;
                        </li>
                        <li>
                            a device the app has not used for 180 days is
                            deleted with everything belonging to it.
                        </li>
                    </ul>
                </li>
                <li>
                    <strong>Processors and recipients:</strong> Expo (650
                    Industries, Inc., USA), Apple and Google as push services.
                </li>
            </ul>
            <p>
                <strong>To stop alerts and delete this data:</strong> tap{" "}
                <strong>Delete my data</strong> in the app&apos;s settings. This
                deletes the device with all its followed trains, push tokens and
                alert state from our server at once, and clears the app&apos;s
                data on your phone; if you are offline, our server is told the
                next time you open the app. Unfollowing a train also deletes it
                from our server at once. Turning notifications off in your
                phone&apos;s settings only hides the alerts. If you delete the
                app, your push token stops working and is removed, and the
                remaining device record, which can no longer be linked to you,
                is deleted after 180 days. On iPhone the device credential may
                stay in the Keychain after deleting the app; if you reinstall
                it, the app removes any trains from our server that it no longer
                has.
            </p>

            <h2>Usage statistics</h2>
            <p>
                To know how many people use the website and the app and which
                features they use, we use{" "}
                <External href="https://posthog.com/">PostHog</External>. We
                record:
            </p>
            <ul>
                <li>
                    what you open (a train, a station, the journey planner,
                    statistics, disruptions) and from where (e.g. search, the
                    map, a shared link or an alert), and how long you look at a
                    train;
                </li>
                <li>
                    for searches, only how long the query was and how many
                    results it found, never the text;
                </li>
                <li>
                    whether you saved or removed a follow, its type and how many
                    days it covers, but not the stations;
                </li>
                <li>
                    share taps, which setting you changed, whether the
                    statistics question was shown and what you answered, and
                    error messages shown to you;
                </li>
                <li>
                    public timetable IDs: train number, station ID, route code
                    and vehicle ID;
                </li>
                <li>
                    with every event: the platform (web, iOS or Android), app
                    version, language, theme and roughly how many trains you
                    follow (0, 1, 2–3, 4+);
                </li>
                <li>
                    on the website also page views (the page address, which may
                    include the train or station you opened), clicks (with text
                    masked) and errors on the site;
                </li>
                <li>
                    in the app also the answer to the notification permission
                    request, which alerts you open (their type and whether they
                    started the app) and whether alerts are on for a follow;
                    PostHog adds the operating system and its version, the
                    device type, language and time zone;
                </li>
                <li>
                    your browser or device type and your IP address, from which
                    PostHog derives an approximate location (country, city).
                </li>
            </ul>
            <p>
                We never send your location, what you type in search, or the
                pair of stations you plan a journey between. We do not create
                user profiles, do not record sessions (screen recordings), and
                never send your name or email address. Nothing is sent from
                development builds.
            </p>

            <h3>Before you decide, or if you reject</h3>
            <ul>
                <li>
                    <strong>Website:</strong> PostHog&apos;s cookieless mode.
                    Nothing is stored in your browser: no cookies and no ID.
                    PostHog&apos;s server computes a hash of your IP address and
                    browser details (user agent) with a secret key
                    (&quot;salt&quot;) that changes every day. This links your
                    visits within a day, but cannot be linked to you the next
                    day, and PostHog deletes the daily salt.
                </li>
                <li>
                    <strong>App:</strong> a random ID is kept in memory for one
                    launch only. Nothing is stored on your phone, so the next
                    launch cannot be linked to it.
                </li>
                <li>
                    Your answer to the statistics question is recorded in the
                    same anonymous way, so we can see how many people accept.
                    Nothing recorded before you accept is linked to you
                    afterwards.
                </li>
                <li>
                    <strong>Legal basis:</strong> legitimate interest (GDPR Art.
                    6(1)(f)): to keep a free hobby project going, we need to
                    know how many people use it and what for. You can object at
                    any time using the email address below.
                </li>
            </ul>

            <h3>If you accept</h3>
            <ul>
                <li>
                    A random ID is stored on your device (on the website, in
                    local storage under keys starting with <code>ph_</code> and{" "}
                    <code>__ph_</code>; in the app, in a file), so your visits
                    can be linked across days (e.g. whether you come back).
                    PostHog also uses a session ID.
                </li>
                <li>
                    <strong>Legal basis:</strong> your consent (GDPR Art.
                    6(1)(a)), which you can withdraw at any time.
                </li>
            </ul>

            <ul>
                <li>
                    <strong>Retention:</strong> at PostHog, for the retention
                    period set in our project, or earlier on request; the ID on
                    your device, until you withdraw consent or clear its data.
                </li>
                <li>
                    <strong>Processor:</strong> PostHog Inc., EU data centre
                    (see below).
                </li>
            </ul>

            <p>
                If you reject, we won&apos;t ask again for six months. You can
                change your choice here or in Settings (on the website and in
                the app) at any time. If you turn it off, we delete the stored
                ID from your browser or phone and go back to anonymous counting.
            </p>
            <div className="not-prose rounded-xl border border-border bg-card p-4">
                <AnalyticsConsentSwitch />
            </div>

            <h2>PostHog</h2>
            <p>
                Statistics are sent to PostHog&apos;s EU cloud
                (eu.i.posthog.com). The app sends them directly; the website
                sends them through our own server, which passes on your IP
                address so that visitors can be counted. PostHog Inc. is a US
                company; safeguards for any access from outside the EU are set
                out in PostHog&apos;s data processing terms.
            </p>

            <h2>Who receives data, and where</h2>
            <ul>
                <li>
                    <strong>Hosting provider</strong> (London, United Kingdom):
                    our servers. The transfer to the UK relies on the European
                    Commission&apos;s adequacy decision for the United Kingdom.
                </li>
                <li>
                    <strong>Cloudflare</strong>: network protection and delivery
                    for the website and our API.
                </li>
                <li>
                    <strong>PostHog</strong> (EU cloud): statistics.
                </li>
                <li>
                    <strong>OpenFreeMap</strong>: base map tiles, loaded
                    directly by your device.
                </li>
                <li>
                    <strong>Expo, Apple and Google</strong>: delivering app
                    alerts. These companies are based in the USA; data may be
                    transferred there under the EU–US Data Privacy Framework or
                    the European Commission&apos;s standard contractual clauses.
                </li>
                <li>
                    <strong>MÁV</strong>: receives journey searches from our
                    server, without any data about you.
                </li>
            </ul>
            <p>We do not sell your data or use it for advertising.</p>

            <h2>Your rights</h2>
            <p>Under the GDPR, you have the right to:</p>
            <ul>
                <li>be informed about and access your data;</li>
                <li>have your data corrected or erased;</li>
                <li>restrict processing;</li>
                <li>object to processing based on legitimate interest;</li>
                <li>
                    withdraw your consent at any time (this does not affect the
                    lawfulness of earlier processing);
                </li>
                <li>receive your data in a portable format.</li>
            </ul>
            <p>
                As we do not know who you are, we can usually only act on data
                you can point us to. You can delete followed trains and their
                alerts yourself in the app, as described above. For statistics,
                we can find your data if you give us the PostHog ID stored on
                your device; we are happy to help with that. Write to us at{" "}
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We
                reply within one month.
            </p>
            <p>
                If you think we have infringed your rights, you can lodge a
                complaint with the Hungarian National Authority for Data
                Protection and Freedom of Information (NAIH, Falk Miksa utca
                9–11, 1055 Budapest, Hungary,{" "}
                <External href="https://naih.hu">naih.hu</External>,
                ugyfelszolgalat@naih.hu), or with the supervisory authority
                where you live, or go to court.
            </p>

            <h2>Changes</h2>
            <p>
                If new features of the site or the app process more data, we
                will update this notice and, where needed, ask you again.
            </p>
        </>
    );
}
