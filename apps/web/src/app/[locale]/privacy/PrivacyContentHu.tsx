import AnalyticsConsentSwitch from "@/components/settings/AnalyticsConsentSwitch";

const CONTACT_EMAIL = "hello@megisholavonat.info";

export default function PrivacyContentHu() {
    return (
        <>
            <p>
                Ebben a tájékoztatóban leírjuk, milyen adatokat kezel a{" "}
                <strong>Mégis hol a vonat?</strong> (megisholavonat.info), miért
                és meddig, és milyen jogaid vannak. Nincs regisztráció, nem
                kérjük el a neved vagy az e-mail-címed. Az oldal egy ingyenes
                hobbiprojekt; a látogatószámot mindenkinél mérjük, de részletes,
                azonosítóhoz kötött statisztikát csak akkor gyűjtünk, ha ehhez
                hozzájárulsz.
            </p>

            <h2>Ki kezeli az adataidat?</h2>
            <p>
                Az oldalt Reicher Martin és Gyóni Márk üzemelteti, közös
                adatkezelőként. Kapcsolat:{" "}
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
            </p>
            <p>
                Az oldal nyílt forráskódú, a kódja megtalálható a{" "}
                <a
                    href="https://github.com/megisholavonat/megisholavonat"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    GitHubon
                </a>
                .
            </p>

            <h2>Az oldal kiszolgálása</h2>
            <p>
                Amikor megnyitod az oldalt, a böngésződ kapcsolatba lép a
                szerverünkkel, és ennek során megkapjuk az IP-címedet, a
                böngésződ adatait (user agent) és azt, hogy melyik oldalt vagy
                adatot kérted. Erre azért van szükség, hogy az oldalt és a
                vonatok adatait egyáltalán el tudjuk küldeni neked, és hogy
                biztonságosan működjön.
            </p>
            <ul>
                <li>
                    <strong>Jogalap:</strong> jogos érdek (GDPR 6. cikk (1) f)
                    pont): a szolgáltatás működtetése és védelme.
                </li>
                <li>
                    <strong>Megőrzés:</strong> a szerver naplóit csak addig
                    őrizzük, amíg az üzemeltetéshez és a biztonsághoz szükséges,
                    utána automatikusan törlődnek.
                </li>
                <li>
                    <strong>Adatfeldolgozó:</strong> EU-s tárhelyszolgáltató.
                </li>
            </ul>
            <p>
                A vonatadatokat kiszolgáló API-nk nem tárol rólad semmit: nincs
                felhasználói fiók, és a kéréseidet nem kapcsoljuk hozzád.
            </p>

            <h2>A térkép</h2>
            <p>
                A térkép megjelenítéséhez a böngésződ közvetlenül tölt le
                térképrészleteket (csempéket) az alábbi helyekről. Ilyenkor ezek
                a szerverek is megkapják az IP-címedet és azt, hogy a térkép
                melyik részét nézed.
            </p>
            <ul>
                <li>
                    <strong>Alaptérkép:</strong> az{" "}
                    <a
                        href="https://openfreemap.org/"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        OpenFreeMap
                    </a>{" "}
                    szerverei (tiles.openfreemap.org).
                </li>
                <li>
                    <strong>Vasúti réteg:</strong> a saját
                    csempe-gyorsítótárunk, amely az{" "}
                    <a
                        href="https://www.openrailwaymap.org/"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        OpenRailwayMap
                    </a>{" "}
                    csempéit tárolja. Az OpenRailwayMap így nem látja az
                    IP-címedet.
                </li>
                <li>
                    <strong>Zászló ikonok</strong> a nyelvválasztóban: a GitHub
                    Pages (purecatamphetamine.github.io).
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
                engedélyezted a böngésződben), a böngésződ megadja a
                helyzetedet. Ezt <strong>csak a te eszközödön</strong>{" "}
                használjuk arra, hogy megmutassuk a térképen, hol vagy. A
                pozíciódat nem küldjük el sem nekünk, sem másnak, és nem
                tároljuk. Az engedélyt bármikor visszavonhatod a böngésződ
                beállításaiban.
            </p>

            <h2>Amit a böngésződben tárolunk</h2>
            <p>
                Egyetlen sütit használunk: a <code>NEXT_LOCALE</code>{" "}
                munkamenet-süti a választott nyelvet jegyzi meg, és a böngésző
                bezárásakor törlődik. A többi beállításodat a böngésződ helyi
                tárolójában (localStorage) őrizzük, és ezek el sem jutnak
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
                    <code>mhav.consent.analytics</code>: hogy engedélyezted-e a
                    részletes statisztikát, és mikor döntöttél.
                </li>
            </ul>
            <p>
                A munkamenet idejére (a böngészőlap bezárásáig) a{" "}
                <code>mhav.consent.prompt</code> kulcsot is eltároljuk a
                munkamenet-tárolóban (sessionStorage), hogy egy újratöltés után
                ne kelljen újra várnod a statisztikáról szóló kérdésre.
            </p>
            <p>
                Ezek az oldal működéséhez és a döntéseid megjegyzéséhez
                szükségesek, ezért ehhez nem kérünk külön hozzájárulást. A
                böngésződ adatainak törlésével bármikor eltávolíthatod őket.
            </p>

            <h2>Látogatószám mérése (mindenkinél)</h2>
            <p>
                Hogy tudjuk, naponta hányan használják az oldalt, a{" "}
                <a
                    href="https://posthog.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    PostHog
                </a>{" "}
                „cookieless” (sütimentes) módját használjuk akkor is, ha még nem
                döntöttél, vagy elutasítottad a részletes statisztikát.
                Ilyenkor:
            </p>
            <ul>
                <li>
                    a böngésződben semmit nem tárolunk: nincs süti és nincs
                    azonosító;
                </li>
                <li>
                    a PostHog megkapja az oldalmegtekintéseket, a kattintásokat
                    (a szövegek kitakarásával), az oldalon előforduló
                    programhibákat, a böngésződ és az eszközöd típusát, valamint
                    az IP-címedet;
                </li>
                <li>
                    a PostHog szervere az IP-címedből és a böngésződ adataiból
                    (user agent) egy naponta cserélődő titkos kulccsal („sóval”)
                    képzett kivonatot (hash) számol. Ez egy napon belül
                    összeköti a látogatásaidat, de másnap már nem lehet hozzád
                    kapcsolni, és a napi kulcsot a PostHog törli.
                </li>
            </ul>
            <ul>
                <li>
                    <strong>Jogalap:</strong> jogos érdek (GDPR 6. cikk (1) f)
                    pont): egy ingyenes hobbiprojekt fenntartásához tudnunk
                    kell, hányan használják. Ez ellen bármikor tiltakozhatsz az
                    alább megadott e-mail-címen.
                </li>
                <li>
                    <strong>Adatfeldolgozó:</strong> PostHog Inc., EU-s
                    adatközpont (lásd lent).
                </li>
            </ul>

            <h2>Részletes statisztika (csak ha engeded)</h2>
            <p>
                Ha az erről szóló kérdésnél az „Elfogadom” gombot választod, a
                PostHog segítségével részletesebb statisztikát gyűjtünk, ami
                segít eldönteni, mit fejlesszünk. Ilyenkor a fentieken túl:
            </p>
            <ul>
                <li>
                    egy véletlenszerű azonosítót tárolunk a böngésződ helyi
                    tárolójában (<code>ph_…</code> és <code>__ph_…</code>{" "}
                    kezdetű kulcsok), hogy a látogatásaidat napokon át össze
                    tudjuk kapcsolni (pl. hogy visszatérsz-e);
                </li>
                <li>
                    a PostHog munkamenet-azonosítót is használ, és az
                    IP-címedből hozzávetőleges helyet (ország, város) állapíthat
                    meg.
                </li>
            </ul>
            <p>
                Munkamenet-felvételt (képernyőfelvételt) egyik esetben sem
                készítünk, az elemek szövegét nem rögzítjük, és a nevedet, az
                e-mail-címedet vagy a pontos helyzetedet nem küldjük el.
            </p>
            <ul>
                <li>
                    <strong>Jogalap:</strong> a hozzájárulásod (GDPR 6. cikk (1)
                    a) pont), amelyet bármikor visszavonhatsz.
                </li>
                <li>
                    <strong>Megőrzés:</strong> a PostHognál a projektünkben
                    beállított megőrzési ideig, kérésre korábban is töröljük; a
                    böngésződben addig, amíg vissza nem vonod a hozzájárulást,
                    vagy nem törlöd a böngésző adatait.
                </li>
            </ul>
            <p>
                Ha elutasítod, fél évig nem kérdezünk újra. A döntésedet itt
                vagy a Beállításokban bármikor megváltoztathatod. Ha
                kikapcsolod, töröljük a böngésződből a PostHog adatait, és
                visszaállunk a sütimentes látogatószám-mérésre.
            </p>
            <div className="not-prose rounded-xl border border-border bg-card p-4">
                <AnalyticsConsentSwitch />
            </div>

            <h2>A PostHog</h2>
            <p>
                A statisztikai adatokat a böngésződ a saját szerverünkön
                keresztül küldi a PostHog EU-s felhőjébe (eu.i.posthog.com). A
                PostHog Inc. amerikai cég; az EU-n kívüli hozzáférésre vonatkozó
                garanciákat a PostHog adatfeldolgozási feltételei tartalmazzák.
            </p>

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
                Mivel nem tudjuk, ki vagy, a statisztikai adataidat csak akkor
                tudjuk megtalálni, ha megadod a böngésződben tárolt PostHog
                azonosítót. Kérésedre ebben is segítünk. Írj nekünk:{" "}
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Egy
                hónapon belül válaszolunk.
            </p>
            <p>
                Ha úgy érzed, hogy megsértettük a jogaidat, panaszt tehetsz a
                Nemzeti Adatvédelmi és Információszabadság Hatóságnál (NAIH,
                1055 Budapest, Falk Miksa utca 9–11.,{" "}
                <a
                    href="https://naih.hu"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    naih.hu
                </a>
                , ugyfelszolgalat@naih.hu), vagy bírósághoz fordulhatsz.
            </p>

            <h2>Változások</h2>
            <p>
                Ha az oldal új funkciói több adatot kezelnek, ezt a tájékoztatót
                frissítjük, és ha kell, újra megkérdezünk.
            </p>
        </>
    );
}
