import AnalyticsConsentSwitch from "@/components/settings/AnalyticsConsentSwitch";

const CONTACT_EMAIL = "hello@megisholavonat.info";

export default function PrivacyContentEn() {
    return (
        <>
            <p>
                This notice explains what data{" "}
                <strong>Mégis hol a vonat?</strong> (megisholavonat.info)
                processes, why and for how long, and what your rights are. There
                is no sign-up, we never ask for your name or email address. The
                site is a free hobby project: we count visitors for everyone,
                but we only collect detailed statistics tied to an ID if you
                agree to it.
            </p>

            <h2>Who is responsible for your data?</h2>
            <p>
                The site is run by Martin Reicher and Márk Gyóni as joint
                controllers. Contact:{" "}
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
            </p>
            <p>
                The site is open source; its code is available on{" "}
                <a
                    href="https://github.com/megisholavonat/megisholavonat"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    GitHub
                </a>
                .
            </p>

            <h2>Serving the site</h2>
            <p>
                When you open the site, your browser connects to our server,
                which receives your IP address, your browser details (user
                agent) and the page or data you requested. This is needed to
                send you the site and the train data at all, and to keep the
                service secure.
            </p>
            <ul>
                <li>
                    <strong>Legal basis:</strong> legitimate interest (GDPR Art.
                    6(1)(f)): running and protecting the service.
                </li>
                <li>
                    <strong>Retention:</strong> server logs are kept only as
                    long as needed for operation and security, then deleted
                    automatically.
                </li>
                <li>
                    <strong>Processor:</strong> a hosting provider in London,
                    United Kingdom.
                </li>
                <li>
                    <strong>Transfer:</strong> the transfer to the UK relies on
                    the European Commission&apos;s adequacy decision for the
                    United Kingdom.
                </li>
            </ul>
            <p>
                Our train data API stores nothing about you: there are no user
                accounts, and your requests are not linked to you.
            </p>

            <h2>The map</h2>
            <p>
                To show the map, your browser downloads map images (tiles)
                directly from the sources below. These servers therefore also
                receive your IP address and which part of the map you are
                looking at.
            </p>
            <ul>
                <li>
                    <strong>Base map:</strong>{" "}
                    <a
                        href="https://openfreemap.org/"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        OpenFreeMap
                    </a>{" "}
                    (tiles.openfreemap.org).
                </li>
                <li>
                    <strong>Railway layer:</strong> our own tile cache, which
                    stores tiles from{" "}
                    <a
                        href="https://www.openrailwaymap.org/"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        OpenRailwayMap
                    </a>
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
                If you tap the location button (or have already allowed it in
                your browser), your browser provides your position. We use it{" "}
                <strong>only on your device</strong> to show where you are on
                the map. Your position is never sent to us or anyone else, and
                it is not stored. You can revoke the permission at any time in
                your browser settings.
            </p>

            <h2>What we store in your browser</h2>
            <p>
                We use a single cookie: the <code>NEXT_LOCALE</code> session
                cookie remembers your language and is deleted when you close
                your browser. Your other preferences are kept in your
                browser&apos;s local storage (localStorage) and never reach us:
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
                These are needed for the site to work and to remember your
                choices, so we do not ask for separate consent. You can remove
                them at any time by clearing your browser data.
            </p>

            <h2>Counting visitors (for everyone)</h2>
            <p>
                To know how many people use the site each day, we use{" "}
                <a
                    href="https://posthog.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    PostHog
                </a>
                &apos;s cookieless mode even if you haven&apos;t decided yet or
                have rejected detailed statistics. In this mode:
            </p>
            <ul>
                <li>
                    nothing is stored in your browser: no cookies and no ID;
                </li>
                <li>
                    PostHog receives page views, clicks (with text masked),
                    errors that occur on the site, your browser and device type,
                    and your IP address;
                </li>
                <li>
                    PostHog&apos;s server computes a hash of your IP address and
                    browser details (user agent) with a secret key
                    (&quot;salt&quot;) that changes every day. This links your
                    visits within a day, but cannot be linked to you the next
                    day, and PostHog deletes the daily salt.
                </li>
            </ul>
            <ul>
                <li>
                    <strong>Legal basis:</strong> legitimate interest (GDPR Art.
                    6(1)(f)): to keep a free hobby project going, we need to
                    know how many people use it. You can object at any time
                    using the email address below.
                </li>
                <li>
                    <strong>Processor:</strong> PostHog Inc., EU data centre
                    (see below).
                </li>
            </ul>

            <h2>Detailed statistics (only if you allow it)</h2>
            <p>
                If you choose “Accept” when asked, we use PostHog to collect
                more detailed statistics that help us decide what to build next.
                In addition to the above:
            </p>
            <ul>
                <li>
                    a random ID is stored in your browser&apos;s local storage
                    (keys starting with <code>ph_</code> and <code>__ph_</code>
                    ), so your visits can be linked across days (e.g. whether
                    you come back);
                </li>
                <li>
                    PostHog also uses a session ID and may derive an approximate
                    location (country, city) from your IP address.
                </li>
            </ul>
            <p>
                In neither case do we record sessions (screen recordings) or
                element text, and we never send your name, email address or
                precise location.
            </p>
            <ul>
                <li>
                    <strong>Legal basis:</strong> your consent (GDPR Art.
                    6(1)(a)), which you can withdraw at any time.
                </li>
                <li>
                    <strong>Retention:</strong> at PostHog, for the retention
                    period set in our project, or earlier on request; in your
                    browser, until you withdraw consent or clear your browser
                    data.
                </li>
            </ul>
            <p>
                If you reject, we won&apos;t ask again for six months. You can
                change your choice here or in Settings at any time. If you turn
                it off, we remove PostHog&apos;s data from your browser and go
                back to cookieless visitor counting.
            </p>
            <div className="not-prose rounded-xl border border-border bg-card p-4">
                <AnalyticsConsentSwitch />
            </div>

            <h2>PostHog</h2>
            <p>
                Your browser sends statistics through our own server to
                PostHog&apos;s EU cloud (eu.i.posthog.com). PostHog Inc. is a US
                company; safeguards for any access from outside the EU are set
                out in PostHog&apos;s data processing terms.
            </p>

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
                As we do not know who you are, we can only find your statistics
                if you give us the PostHog ID stored in your browser; we are
                happy to help with that. Write to us at{" "}
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We
                reply within one month.
            </p>
            <p>
                If you think we have infringed your rights, you can lodge a
                complaint with the Hungarian National Authority for Data
                Protection and Freedom of Information (NAIH, Falk Miksa utca
                9–11, 1055 Budapest, Hungary,{" "}
                <a
                    href="https://naih.hu"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    naih.hu
                </a>
                , ugyfelszolgalat@naih.hu), or with the supervisory authority
                where you live, or go to court.
            </p>

            <h2>Changes</h2>
            <p>
                If new features of the site process more data, we will update
                this notice and, where needed, ask you again.
            </p>
        </>
    );
}
