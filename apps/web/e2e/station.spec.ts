import {
    boardRegion,
    expect,
    openHome,
    STATIONS,
    TRAINS,
    t,
    test,
    trainRegion,
} from "./support/test";

const openBoard = async (page: Parameters<typeof openHome>[0]) => {
    await openHome(page, `?station=${STATIONS.szolnok.id}`);
    const board = boardRegion(page, STATIONS.szolnok.name);
    await expect(board).toBeVisible();
    return board;
};

test("the station board lists departures and arrivals", async ({ page }) => {
    const board = await openBoard(page);
    await expect(
        board.getByRole("heading", { name: STATIONS.szolnok.name }),
    ).toBeVisible();
    const departures = board.getByRole("tab", { name: t.Station.departures });
    await expect(departures).toHaveAttribute("aria-selected", "true");
    // A canceled departure says so
    await expect(board.getByText(t.Station.canceled).first()).toBeVisible();

    await board.getByRole("tab", { name: t.Station.arrivals }).click();
    await expect(
        board.getByRole("tab", { name: t.Station.arrivals }),
    ).toHaveAttribute("aria-selected", "true");
    // 9 TRANSCARPATHIA arrives from Kyiv
    await expect(board).toContainText("Kyiv");
});

test("a board row opens its train", async ({ page }) => {
    const board = await openBoard(page);
    await board
        .getByRole("button", { name: /\b9\b/ })
        .filter({ hasText: "Budapest-Keleti" })
        .first()
        .click();
    const region = trainRegion(page);
    await expect(region).toBeVisible();
    await expect(region).toContainText("Budapest-Keleti");
    await expect
        .poll(() => new URL(page.url()).searchParams.get("vehicleId"))
        .toBe(TRAINS.late.id);
});

test("P1: a board row on time shows no delay reason", async ({ page }) => {
    const board = await openBoard(page);
    const row = board.getByRole("button").filter({ hasText: "6009" });
    await expect(row).toBeVisible();
    await expect(row).not.toContainText(t.Delay.on_time);
    await expect(row).not.toContainText("Műszaki hiba");
});
