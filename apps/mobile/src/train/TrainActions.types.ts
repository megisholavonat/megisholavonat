export interface TrainActionsProps {
    /** The train is followed (a trip or a commute) */
    following: boolean;
    onFollow: () => void;
    onShare: () => void;
    onTicket: () => void;
}
