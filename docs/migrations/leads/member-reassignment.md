# Member removal and lead reassignment

S7.2 changes no tables. Removing a member moves every open, live, unmerged lead in the same transaction as deactivation, session revocation and audit. The destination can be another active member or `null` to leave those leads unassigned. Closed leads keep their historical owner.

The assignment writer records one event per moved lead, one `leads.assign` audit and one notification when a destination receives work. A failure rolls back the whole removal.
