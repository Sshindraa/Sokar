export class WaitingListDisabledError extends Error {
  constructor() {
    super('Waiting list is not enabled for this restaurant');
    this.name = 'WaitingListDisabledError';
  }
}

export class WaitingListSlotFullError extends Error {
  constructor(
    public readonly restaurantId: string,
    public readonly slotStart: Date,
    public readonly maxEntries: number,
  ) {
    super(
      `Waiting list slot full: restaurant=${restaurantId} slot=${slotStart.toISOString()} max=${maxEntries}`,
    );
    this.name = 'WaitingListSlotFullError';
  }
}

export class WaitingListAlreadyExistsError extends Error {
  constructor(
    public readonly restaurantId: string,
    public readonly customerPhoneNormalized: string,
    public readonly slotStart: Date,
  ) {
    super(
      `Waiting list entry already exists: restaurant=${restaurantId} phone=${customerPhoneNormalized} slot=${slotStart.toISOString()}`,
    );
    this.name = 'WaitingListAlreadyExistsError';
  }
}

export class WaitingListEntryNotFoundError extends Error {
  constructor(public readonly entryId: string) {
    super(`Waiting list entry not found: ${entryId}`);
    this.name = 'WaitingListEntryNotFoundError';
  }
}

export class WaitingListAlreadyPromotedError extends Error {
  constructor(public readonly entryId: string) {
    super(`Waiting list entry already promoted: ${entryId}`);
    this.name = 'WaitingListAlreadyPromotedError';
  }
}
