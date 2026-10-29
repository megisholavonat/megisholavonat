import AnalyticsConsentSwitch from "@/components/settings/AnalyticsConsentSwitch";

const CONTACT_EMAIL = "hello@megisholavonat.info";

function External({ href, children }: { href: string; children: string }) {
    return (
        <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
        </a>
    );
}

export default function PrivacyContentHu() {
    return (
        <>
            <p>
                Ebben a tájékoztatóban leírjuk, milyen adatokat kezel a{" "}
                <strong>Mégis hol a vonat?</strong> (a megisholavonat.info
                weboldal és az MHaV alkalmazás iPhone-ra és Androidra), miért és
                meddig, ki kapja még meg őket, és milyen jogaid vannak. Nincs
                regisztráció: nem kérjük el a neved, az e-mail-címed vagy a
                telefonszámod. Ez egy ingyenes hobbiprojekt. A látogatószámot
                mindenkinél mérjük, de részletes, azonosítóhoz kötött
                statisztikát csak akkor gyűjtünk, ha ehhez hozzájárulsz.
            </p>

            <h2>Ki kezeli az adataidat?</h2>
            <p>
                Az oldalt és az alkalmazást Reicher Martin és Gyóni Márk
                üzemelteti, közös adatkezelőként. Kapcsolat:{" "}
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
            </p>
            <p>
                A projekt nyílt forráskódú, a kódja megtalálható a{" "}
                <External href="https://github.com/megisholavonat/megisholavonat">
                    GitHubon
                </External>
                .
            </p>

            <h2>Röviden</h2>
            <table>
                <thead>
                    <tr>
                        <th>Mit</th>
                        <th>Miért</th>
                        <th>Meddig</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>IP-cím, böngésző adatai, a kért cím</td>
                        <td>
                            Az oldal és az alkalmazás kiszolgálása, biztonság
                        </td>
                        <td>
                            Felülíródó szervernaplók; korlátozás: legfeljebb 1
                            óra
                        </td>
                    </tr>
                    <tr>
                        <td>A tartózkodási helyed</td>
                        <td>Hogy lásd magad a térképen</td>
                        <td>Nem tároljuk, nem hagyja el az eszközödet</td>
                    </tr>
                    <tr>
                        <td>
                            Beállítások, legutóbbi állomások, követett vonatok
                            (web)
                        </td>
                        <td>A döntéseid megjegyzése</td>
                        <td>Az eszközödön, amíg nem törlöd</td>
                    </tr>
                    <tr>
                        <td>
                            Az alkalmazás eszközazonosítója, push-tokenje,
                            követett vonatai, értesítési állapota
                        </td>
                        <td>A kért értesítések küldése</td>
                        <td>
                            Amíg nem állítod le a követést; 180 nap használaton
                            kívül minden törlődik
                        </td>
                    </tr>
                    <tr>
                        <td>Azonosító nélküli használati statisztika</td>
                        <td>Látogatószám mérése</td>
                        <td>A PostHognál, lásd lent</td>
                    </tr>
                    <tr>
                        <td>Véletlen azonosítóhoz kötött statisztika</td>
                        <td>
                            Csak a hozzájárulásoddal: a szolgáltatás fejlesztése
                        </td>
                        <td>
                            A PostHognál, amíg vissza nem vonod a hozzájárulást
                        </td>
                    </tr>
                </tbody>
            </table>

            <h2>Az oldal és az alkalmazás kiszolgálása</h2>
            <p>
                Amikor megnyitod az oldalt vagy az alkalmazást, az eszközöd
                kapcsolatba lép a szerverünkkel, és ennek során megkapjuk az
                IP-címedet, a böngésződ vagy az alkalmazás adatait (user agent)
                és azt, hogy melyik oldalt vagy adatot kérted. Erre azért van
                szükség, hogy az oldalt és a vonatok adatait egyáltalán el
                tudjuk küldeni neked, és hogy biztonságosan működjön. A kérések
                először a Cloudflare hálózatán haladnak át, amely védi és
                gyorsítja a szolgáltatást; a Cloudflare továbbadja nekünk az
                IP-címedet.
            </p>
            <ul>
                <li>
                    <strong>Jogalap:</strong> jogos érdek (GDPR 6. cikk (1) f)
                    pont): a szolgáltatás működtetése és védelme.
                </li>
                <li>
                    <strong>Megőrzés:</strong> a szervernaplókat nem archiváljuk
                    és nem gyűjtjük össze, az új bejegyzések automatikusan
                    felülírják őket. A visszaélések ellen az alkalmazás
                    eszközeinek regisztrációját IP-címenként (IPv6 esetén a
                    hálózati előtag szerint) korlátozzuk; ez a számláló
                    legfeljebb egy óra múlva törlődik.
                </li>
                <li>
                    <strong>Adatfeldolgozók:</strong> londoni (Egyesült
                    Királyság) tárhelyszolgáltató és a Cloudflare.
                </li>
            </ul>

            <h2>Vonatadatok, statisztika és útvonaltervezés</h2>
            <p>
                A vonatok helyzete, késése, az állomási táblák és a pontossági
                statisztika a vonatokról szól, nem rólad: ezeket a MÁV nyilvános
                adataiból gyűjtjük, és a felhasználóinkhoz nem kapcsoljuk.
            </p>
            <p>
                Útvonaltervezéskor az eszközöd elküldi a szerverünknek a két
                állomást és a választott időpontot. A szerverünk ezután a saját
                nevében kérdezi meg a MÁV útvonaltervezőjét, így a MÁV csak az
                állomásokat és az időpontot kapja meg, az IP-címedet és rólad
                semmit sem. Az eredményt egy percig megőrizzük, hogy az azonos
                keresések gyorsabbak legyenek; ezt nem kapcsoljuk hozzád.
            </p>
            <p>
                Ha megosztasz egy vonatot vagy állomást, az előnézeti képet a
                szerverünk csak vonatadatokból készíti, személyes adatot nem
                használ.
            </p>

            <h2>A térkép</h2>
            <p>
                A térkép megjelenítéséhez a weboldal és az alkalmazás
                közvetlenül tölt le térképrészleteket (csempéket) az alábbi
                helyekről. Ilyenkor ezek a szerverek is megkapják az IP-címedet
                és azt, hogy a térkép melyik részét nézed.
            </p>
            <ul>
                <li>
                    <strong>Alaptérkép:</strong> az{" "}
                    <External href="https://openfreemap.org/">
                        OpenFreeMap
                    </External>{" "}
                    szerverei (tiles.openfreemap.org).
                </li>
                <li>
                    <strong>Vasúti réteg:</strong> a saját csempe-gyorsítótárunk
                    (tc.megisholavonat.info), amely az{" "}
                    <External href="https://www.openrailwaymap.org/">
                        OpenRailwayMap
                    </External>{" "}
                    csempéit tárolja. Az OpenRailwayMap így nem látja az
                    IP-címedet.
                </li>
            </ul>
            <p>
                <strong>Jogalap:</strong> jogos érdek (GDPR 6. cikk (1) f)
                pont): enélkül a térkép nem tud megjelenni. A betűtípusokat a
                saját szerverünkről töltjük be, nem a Google-tól.
            </p>

            <h2>A tartózkodási helyed</h2>
            <p>
                Ha megnyomod a helymeghatározás gombját (vagy korábban már
                engedélyezted), a böngésződ vagy a telefonod megadja a
                helyzetedet. Ezt <strong>csak a te eszközödön</strong>{" "}
                használjuk arra, hogy megmutassuk a térképen, hol vagy. A
                pozíciódat nem küldjük el sem nekünk, sem másnak, és nem
                tároljuk. Az engedélyt bármikor visszavonhatod a böngésződ vagy
                a telefonod beállításaiban.
            </p>

            <h2>Mit tárolunk az eszközödön?</h2>
            <p>
                A weboldalon egyetlen sütit használunk: a{" "}
                <code>NEXT_LOCALE</code> munkamenet-süti megjegyzi a nyelvet, és
                a böngésző bezárásakor törlődik. Minden mást a böngésződ helyi
                tárolójában (localStorage) tartunk, és ezek nem jutnak el
                hozzánk:
            </p>
            <ul>
                <li>
                    <code>mhav.settings.*</code>: a térkép beállításai (pl.
                    állomásnevek, járműtípusok, animáció);
                </li>
                <li>
                    <code>theme</code>: a választott téma (világos, sötét vagy
                    rendszer);
                </li>
                <li>
                    <code>mhav.recentStations</code>: a legutóbb keresett
                    állomások;
                </li>
                <li>
                    <code>mhav.follows</code>: a weboldalon követett vonatok.
                    Ezek csak a böngésződben vannak, a weboldal nem küld
                    értesítést;
                </li>
                <li>
                    <code>mhav.consent.analytics</code>: hogy engedélyezted-e a
                    részletes statisztikát, és mikor döntöttél.
                </li>
            </ul>
            <p>
                Csak az aktuális munkamenetre (a lap bezárásáig) a
                munkamenet-tárolóban (sessionStorage) is tartunk egy{" "}
                <code>mhav.consent.prompt</code> kulcsot, hogy újratöltés után
                ne kelljen ismét várnod a statisztikáról szóló kérdésre.
            </p>
            <p>
                Az alkalmazás a beállításaidat (a statisztikáról hozott
                döntésedet is) és a követett vonatokat fájlokban tárolja a
                telefonodon. Ha követsz egy vonatot, az eszköz belépési adatát
                (lásd lent) is eltárolja az iPhone kulcskarikájában (Keychain)
                vagy az Android kulcstárában (Keystore).
            </p>
            <p>
                Ezek az oldal és az alkalmazás működéséhez és a döntéseid
                megjegyzéséhez szükségesek, ezért nem kérünk hozzájuk külön
                hozzájárulást. Bármikor törölheted őket a böngésző adatainak
                törlésével vagy az alkalmazás eltávolításával.
            </p>

            <h2>Vonatok követése és értesítések az alkalmazásban</h2>
            <p>
                Az alkalmazásban egy vonatot egyszer vagy rendszeres útként
                követhetsz, és értesítést kaphatsz, ha késik, ha változik a
                vágánya, vagy ha az előtte közlekedő vonat késik. Ehhez a
                szerverünknek tudnia kell, mit figyeljen, és hová küldje az
                értesítést. Fiók nincs: amikor először követsz egy vonatot, az
                alkalmazás egy névtelen eszközt regisztrál a szerverünkön. Ezt
                tároljuk:
            </p>
            <ul>
                <li>
                    <strong>az eszköz:</strong> egy véletlenszerű azonosító, a
                    titkos kulcsának lenyomata (maga a kulcs a telefonod
                    kulcskarikájában vagy kulcstárában marad), a platform (iOS
                    vagy Android), az alkalmazás nyelve (az értesítések
                    nyelvéhez), a létrehozás ideje és az a nap, amikor utoljára
                    kapcsolatba lépett velünk;
                </li>
                <li>
                    <strong>a követett vonatok:</strong> a vonatszám, a dátum
                    (egyszeri útnál) vagy a hét napjai (rendszeres útnál), a
                    fel- és leszállási állomásod, valamint az értesítési
                    beállítások (késési küszöb, vágányváltozás);
                </li>
                <li>
                    <strong>a push-token:</strong> ha engedélyezed az
                    értesítéseket, az alkalmazás push-címe (Expo push-token), és
                    hogy a legutóbbi kézbesítések sikerültek-e;
                </li>
                <li>
                    <strong>értesítési állapot:</strong> az utoljára jelzett
                    késés és vágány, és hogy mikor jeleztük, hogy ne kapd meg
                    kétszer ugyanazt az értesítést.
                </li>
            </ul>
            <p>
                iPhone-on, ha egy követett vonatot élő tevékenységként (Live
                Activity) jelenítesz meg, az alkalmazás ennek a tevékenységnek a
                saját push-tokenjét is elküldi a szerverünknek, mi pedig az
                Apple push-szolgáltatásán keresztül küldjük rá a frissítéseket.
            </p>
            <p>
                Az értesítéseket az Expo push-szolgáltatásán keresztül küldjük,
                amely iPhone-ra az Apple-nek (APNs), Androidra a Google-nek
                (Firebase Cloud Messaging) adja tovább őket. Ők a push-tokent és
                az értesítés tartalmát kapják meg: a vonatot, a késését vagy a
                vágányát, és az azonosítókat, amelyekkel az alkalmazás a
                megfelelő vonatot nyitja meg.
            </p>
            <ul>
                <li>
                    <strong>Jogalap:</strong> az általad kért szolgáltatás
                    nyújtása (GDPR 6. cikk (1) b) pont). Értesítést csak akkor
                    küldünk, ha a telefonodon engedélyezed.
                </li>
                <li>
                    <strong>Megőrzés:</strong>
                    <ul>
                        <li>
                            ha leállítod egy vonat követését, azonnal töröljük
                            azt és az értesítési állapotát;
                        </li>
                        <li>
                            az egyszeri utat két nappal a dátuma után, az
                            értesítési állapotot két nappal az érintett nap után
                            automatikusan töröljük;
                        </li>
                        <li>
                            az élő tevékenység tokenjét a tevékenység végén,
                            legkésőbb 12 óra után töröljük;
                        </li>
                        <li>
                            a push-tokent töröljük, amint az Apple vagy a Google
                            érvénytelennek jelzi (pl. az alkalmazás törlése
                            után), vagy ha többször egymás után nem sikerül a
                            kézbesítés;
                        </li>
                        <li>
                            azt az eszközt, amelyet az alkalmazás 180 napig nem
                            használt, minden hozzá tartozó adattal együtt
                            töröljük.
                        </li>
                    </ul>
                </li>
                <li>
                    <strong>Adatfeldolgozók és címzettek:</strong> az Expo (650
                    Industries, Inc., USA), az Apple és a Google mint
                    push-szolgáltatók.
                </li>
            </ul>
            <p>
                <strong>Az értesítések leállítása és az adatok törlése:</strong>{" "}
                állítsd le a vonataid követését az alkalmazásban; ez azonnal
                törli őket a szerverünkről. Ha a telefonod beállításaiban
                kapcsolod ki az értesítéseket, azok csak nem jelennek meg. Ha
                törlöd az alkalmazást, a push-tokened érvénytelenné válik, és
                töröljük, a megmaradt eszközadatot pedig, amely már nem
                kapcsolható hozzád, 180 nap múlva töröljük. iPhone-on az eszköz
                belépési adata az alkalmazás törlése után is megmaradhat a
                kulcskarikában; ha újratelepíted, az alkalmazás eltávolítja a
                szerverről azokat a vonatokat, amelyek már nincsenek meg nála.
            </p>

            <h2>Látogatószám-mérés (mindenkinél)</h2>
            <p>
                Hogy tudjuk, naponta hányan használják a weboldalt és mely
                funkcióit, a{" "}
                <External href="https://posthog.com/">PostHog</External>{" "}
                sütimentes módját akkor is használjuk, ha még nem döntöttél,
                vagy elutasítottad a részletes statisztikát. Ebben a módban:
            </p>
            <ul>
                <li>
                    a böngésződben semmit sem tárolunk: se sütit, se azonosítót;
                </li>
                <li>
                    a PostHog megkapja az oldalmegtekintéseket (az oldal címét,
                    amelyben benne lehet a megnyitott vonat vagy állomás), a
                    kattintásokat (a szövegük nélkül), hogy mely funkciókat
                    használod (pl. keresés, vonat követése, útvonaltervezés,
                    megosztás, olyan részletekkel, mint a vonatszám, az
                    állomásazonosító vagy darabszámok, de soha nem azt, amit
                    beírsz, és nem a helyzetedet), az oldalon előforduló
                    hibákat, a böngésződ és az eszközöd típusát, valamint az
                    IP-címedet, amelyből hozzávetőleges helyet (ország, város)
                    állapíthat meg;
                </li>
                <li>
                    a PostHog szervere az IP-címedből és a böngésződ adataiból
                    (user agent) egy naponta cserélődő titkos kulccsal („só”)
                    lenyomatot (hash-t) képez. Ezzel egy napon belül össze tudja
                    kapcsolni a látogatásaidat, de másnap már nem lehet hozzád
                    kötni, a napi sót pedig a PostHog törli.
                </li>
            </ul>
            <p>
                Az alkalmazás csak így, illetve a hozzájárulásoddal az alább
                leírt módon méri a használatot.
            </p>
            <ul>
                <li>
                    <strong>Jogalap:</strong> jogos érdek (GDPR 6. cikk (1) f)
                    pont): egy ingyenes hobbiprojekt fenntartásához tudnunk
                    kell, hányan és mire használják. Ez ellen bármikor
                    tiltakozhatsz az alább megadott e-mail-címen.
                </li>
                <li>
                    <strong>Adatfeldolgozó:</strong> PostHog Inc., EU-s
                    adatközpont (lásd lent).
                </li>
            </ul>

            <h2>Részletes statisztika (csak ha engeded)</h2>
            <p>
                Ha az erről szóló kérdésnél a weboldalon vagy az alkalmazásban
                az „Elfogadom” gombot választod, a PostHog segítségével
                részletesebb statisztikát gyűjtünk, ami segít eldönteni, mit
                fejlesszünk. Ugyanazokat az eseményeket rögzítjük, mint fent,
                de:
            </p>
            <ul>
                <li>
                    egy véletlenszerű azonosítót tárolunk az eszközödön (a
                    weboldalon a helyi tárolóban, <code>ph_…</code> és{" "}
                    <code>__ph_…</code> kezdetű kulcsokkal), hogy a
                    látogatásaidat napokon át össze tudjuk kapcsolni (pl. hogy
                    visszatérsz-e);
                </li>
                <li>a PostHog munkamenet-azonosítót is használ.</li>
            </ul>
            <p>
                Felhasználói profilt nem hozunk létre, munkamenet-felvételt
                (képernyőfelvételt) nem készítünk, azt a szöveget, amire
                koppintasz, nem rögzítjük, és a nevedet, az e-mail-címedet vagy
                a pontos helyzetedet soha nem küldjük el.
            </p>
            <ul>
                <li>
                    <strong>Jogalap:</strong> a hozzájárulásod (GDPR 6. cikk (1)
                    a) pont), amelyet bármikor visszavonhatsz.
                </li>
                <li>
                    <strong>Megőrzés:</strong> a PostHognál a projektünkben
                    beállított megőrzési ideig, kérésre korábban is töröljük; az
                    eszközödön addig, amíg vissza nem vonod a hozzájárulást,
                    vagy nem törlöd az adatait.
                </li>
            </ul>
            <p>
                Ha elutasítod, fél évig nem kérdezünk újra. A döntésedet itt
                vagy a Beállításokban (a weboldalon és az alkalmazásban is)
                bármikor megváltoztathatod. Ha a weboldalon kikapcsolod,
                töröljük a böngésződből a PostHog adatait, és visszaállunk a
                sütimentes látogatószám-mérésre.
            </p>
            <div className="not-prose rounded-xl border border-border bg-card p-4">
                <AnalyticsConsentSwitch />
            </div>

            <h2>A PostHog</h2>
            <p>
                A statisztikai adatok a PostHog EU-s felhőjébe
                (eu.i.posthog.com) kerülnek; a weboldal a saját szerverünkön
                keresztül küldi őket, amely a látogatók számlálásához továbbítja
                az IP-címedet. A PostHog Inc. amerikai cég; az EU-n kívüli
                hozzáférésre vonatkozó garanciákat a PostHog adatfeldolgozási
                feltételei tartalmazzák.
            </p>

            <h2>Ki kap adatot, és hol?</h2>
            <ul>
                <li>
                    <strong>Tárhelyszolgáltató</strong> (London, Egyesült
                    Királyság): a szervereink. Az Egyesült Királyságba történő
                    továbbítás az Európai Bizottság Egyesült Királyságra
                    vonatkozó megfelelőségi határozatán alapul.
                </li>
                <li>
                    <strong>Cloudflare</strong>: a weboldal és az API-nk
                    hálózati védelme és kiszolgálása.
                </li>
                <li>
                    <strong>PostHog</strong> (EU-s felhő): statisztika.
                </li>
                <li>
                    <strong>OpenFreeMap</strong>: az alaptérkép csempéi,
                    amelyeket az eszközöd közvetlenül tölt le.
                </li>
                <li>
                    <strong>Expo, Apple és Google</strong>: az alkalmazás
                    értesítéseinek kézbesítése. Ezek amerikai cégek; az adatok
                    az EU–USA adatvédelmi keretrendszer vagy az Európai
                    Bizottság általános szerződési feltételei alapján
                    kerülhetnek az Egyesült Államokba.
                </li>
                <li>
                    <strong>MÁV</strong>: a szerverünktől kapja az
                    útvonalkereséseket, rád vonatkozó adat nélkül.
                </li>
            </ul>
            <p>Az adataidat nem adjuk el, és nem használjuk hirdetésre.</p>

            <h2>A jogaid</h2>
            <p>A GDPR alapján jogod van:</p>
            <ul>
                <li>tájékoztatást és hozzáférést kérni az adataidhoz;</li>
                <li>kérni az adataid helyesbítését vagy törlését;</li>
                <li>kérni az adatkezelés korlátozását;</li>
                <li>tiltakozni a jogos érdeken alapuló adatkezelés ellen;</li>
                <li>
                    a hozzájárulásodat bármikor visszavonni (ez nem érinti a
                    korábbi adatkezelés jogszerűségét);
                </li>
                <li>kérni az adataid hordozható formában való kiadását.</li>
            </ul>
            <p>
                Mivel nem tudjuk, ki vagy, általában csak olyan adattal tudunk
                foglalkozni, amelyet meg tudsz mutatni nekünk. A követett
                vonatokat és az értesítéseiket a fent leírt módon magad is
                törölheted az alkalmazásban. A statisztikai adataidat akkor
                tudjuk megtalálni, ha megadod az eszközödön tárolt PostHog
                azonosítót; ebben szívesen segítünk. Írj nekünk:{" "}
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Egy
                hónapon belül válaszolunk.
            </p>
            <p>
                Ha úgy érzed, hogy megsértettük a jogaidat, panaszt tehetsz a
                Nemzeti Adatvédelmi és Információszabadság Hatóságnál (NAIH,
                1055 Budapest, Falk Miksa utca 9–11.,{" "}
                <External href="https://naih.hu">naih.hu</External>,
                ugyfelszolgalat@naih.hu), vagy bírósághoz fordulhatsz.
            </p>

            <h2>Változások</h2>
            <p>
                Ha az oldal vagy az alkalmazás új funkciói több adatot kezelnek,
                ezt a tájékoztatót frissítjük, és ha kell, újra megkérdezünk.
            </p>
        </>
    );
}
