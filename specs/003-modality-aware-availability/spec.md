# Feature Specification: Modality-Aware Availability

**Feature Branch**: `003-modality-aware-availability`

**Created**: 2026-09-25

**Status**: Decisión D1 confirmada el 2026-11-03. Implementación parcial en Beta; fases de bloqueos manuales y reglas operativas pendientes

**Input**: User description: "Rental availability varies by case: a monthly rental is not the same
as a daily rental or an hourly rental such as a sports court, so each case must be evaluated
individually."

## Decisión definitiva D1 — 2026-11-03 (prevalece sobre aclaraciones de septiembre)

El propietario del producto confirmó expresamente: **cada Alquiler registrado, no cancelado y no eliminado, bloquea de inmediato el intervalo completo [inicio_at, fin_at), aunque no tenga Seña pagada**. Esto aplica por hora, por día, por semanas y por mes, con una única línea de ocupación por Unidad física, independientemente de la modalidad. La confirmación contractual del Alquiler es el registro; no se exige un paso de confirmación o cobro adicional para bloquear.

- Registrar, mover, extender y cancelar/liberar un Alquiler debe mantener el calendario coherente y respetar la exclusión GiST existente. Un cobro, no cobro, reembolso o anulación de Seña **no** libera la Unidad por sí mismo.
- **Unidad.estado permanece independiente**: una Unidad `publicada` sigue visible y públicamente consultable durante el Alquiler. No pasa automáticamente a `no_disponible`, `pausada` ni `archivada`.
- Si el instante actual pertenece a un intervalo vigente, el aviso público **«Esta unidad se encuentra alquilada hasta el [fecha/hora de finalización]»** aparece de forma destacada, en español, inglés y portugués, con zona horaria `America/Argentina/Buenos_Aires`. Las horas se muestran cuando sean relevantes. Los Alquileres consecutivos, sin espacio libre, deben anunciar la terminación del tramo continuo.
- Los Alquileres solo futuros se marcan en el calendario, **sin** afirmar que la Unidad está alquilada ahora. Una vez terminado un intervalo, desaparece el aviso de ocupación actual; el anuncio sigue público.
- El calendario público no expone identidad del Inquilino, IDs de contrato, pagos, señas ni referencias de gestión.
- En la etapa parcial vigente, ausencia de ocupaciones significa solo «sin reservas registradas» y **no** disponibilidad confirmada: todavía no existen cierres por mantenimiento, horario semanal ni buffer entre turnos.

## Clarifications

### Session 2026-09-25

- Q: Si una misma Unidad ofrece modalidades mensual, diaria y por hora, ¿un bloqueo confirmado en cualquiera debe impedir períodos superpuestos en todas las demás modalidades? → A: Sí. La ocupación es global para la Unidad física; recursos utilizables en paralelo se modelan como Unidades distintas dentro de un Grupo.
- Q: ¿En qué momento debe comenzar el bloqueo de disponibilidad asociado a una Seña? → A HISTÓRICA (SUSTITUIDA el 2026-11-03): el bloqueo se vinculaba al cobro de la Seña. **Regla vigente:** el Alquiler se bloquea desde su registro, aun sin Seña.
- Q: ¿Dónde deben configurarse los horarios habilitados y el tiempo de separación entre turnos para alquileres por hora? → A: Por Unidad, con la opción explícita de definir una configuración común en el Grupo para que sus Unidades la hereden. Cada Unidad puede mantener una excepción propia, que prevalece sobre la regla del Grupo.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Define Availability by Rental Modality (Priority: P1)

As a Gestor, I need availability rules that match each Modalidad de precio so that a monthly home,
a nightly/day-based stay, and an hourly court are not forced into one inaccurate calendar model.

**Why this priority**: Availability is the foundation for preventing overlaps and for deciding what
a registered Alquiler blocks, regardless of Seña. A wrong shared model would corrupt both operational and public behavior.

**Independent Test**: Configure representative monthly, daily, and hourly Unidades, create valid
availability blocks for each, and verify that each modality uses its own required precision and
boundary rules without changing the Unidad's manual general state.

**Acceptance Scenarios**:

1. **Given** a monthly modality, **When** the Gestor records a non-cancelled Alquiler,
   **Then** the exact long-term local-date period becomes unavailable without changing
   `Unidad.estado`.
2. **Given** a daily modality, **When** the Gestor records a non-cancelled stay, **Then** the
   occupied nights/days follow explicit arrival/departure boundaries and adjacent non-overlapping
   stays remain possible.
3. **Given** an hourly modality, **When** the Gestor records a non-cancelled turn, **Then** the
   exact local start/end times are blocked and adjacent valid turns remain possible.
4. **Given** a modality whose minimum duration is greater than one unit, **When** a period is
   entered, **Then** it is rejected unless it meets the modality's `cantidad_tiempo` minimum.
5. **Given** a Grupo with an explicit hourly schedule and turnaround buffer, **When** several of its
   Unidades have no individual override, **Then** they inherit that common rule; a Unidad with an
   individual override keeps its own rule without changing the occupancy timeline of any sibling.

---

### User Story 2 - Prevent Conflicting Occupancy (Priority: P1)

As a Gestor, I need the system to reject overlapping blocked periods so that the same physical
Unidad is not promised to more than one Inquilino.

**Why this priority**: Overbooking is the central operational risk of availability management.

**Independent Test**: Create one confirmed block and attempt complete, partial, containing,
contained, and boundary-adjacent periods for every modality. Only non-overlapping boundary-adjacent
periods are accepted.

**Acceptance Scenarios**:

1. **Given** an existing active block, **When** a second period overlaps it by any positive amount,
   **Then** the second operation fails atomically with a clear conflict result.
2. **Given** an existing block, **When** a second period begins exactly when the first ends, **Then**
   it can be accepted if it also satisfies the modality's operational buffer.
3. **Given** concurrent attempts for the same period, **When** both reach persistence, **Then** at
   most one succeeds.
4. **Given** one Unidad with multiple Modalidades de precio, **When** periods are created through
   different modalities, **Then** every block participates in one global occupancy timeline for
   that physical Unidad and any positive overlap is rejected.

---

### User Story 3 - Block From Registration, Independent of Seña (Priority: P1)

As a Gestor, I need every saved Alquiler to reserve its exact period immediately, even without a paid Seña, so the same physical Unidad cannot be committed twice. The unit listing must remain public.

**Independent Test**: create Alquileres with no Seña, pending Seña, collected Seña and total payment. All reserve their exact period upon registration. Change payment status or refund Seña; the reservation must remain blocked. Cancel or soft-delete: release for new reservations while retaining rental audit history. Unidad.estado remains unchanged.

**Acceptance Scenarios**:

1. **Given** no paid Seña, **When** an Alquiler is saved, **Then** the full interval immediately blocks further overlapping bookings.
2. **Given** a Seña is collected, refunded or absent, **When** financial information changes, **Then** the booking interval remains unchanged.
3. **Given** an existing Alquiler, **When** its dates extend into another reserved period, **Then** the update fails atomically and the old period stays blocked.
4. **Given** a cancelled or soft-deleted Alquiler, **When** the operation commits, **Then** the old interval no longer blocks future bookings; its historical record remains auditable.
5. **Given** a published unit currently rented, **When** the public listing loads, **Then** a localized notice accurately states the current rental end date/time without removing the listing from search.
6. **Given** only a future reservation, **When** public availability loads, **Then** the page shows it as future occupancy but does not claim the unit is currently rented.

---

### User Story 4 - Present Safe Public Availability (Priority: P2)

As a public user, I need to see reliable available/unavailable periods at the right precision so I
can evaluate a Unidad without seeing private Alquiler, Inquilino, payment, or exact operational
details.

**Why this priority**: Calendar blocking has value only if the marketplace can expose it safely and
understandably.

**Independent Test**: Request public availability anonymously for monthly, daily, and hourly
examples. The response and UI show only blocked/available periods, remain timezone-correct, and
contain no private identifiers or financial data.

**Acceptance Scenarios**:

1. **Given** an anonymous visitor, **When** public availability is loaded, **Then** only normalized
   occupied/free periods and modality rules are disclosed.
2. **Given** no future availability data, **When** the calendar loads, **Then** it shows an explicit
   unknown/not-configured state rather than random availability.
3. **Given** loading or service failure, **When** availability cannot be obtained, **Then** the UI
   shows a localized retryable error and never labels the Unidad available by assumption.
4. **Given** desktop and responsive web, **When** monthly, daily, and hourly calendars are used,
   **Then** each interaction remains keyboard accessible, touch-friendly, and visually verified at
   375, 768, 1024, and 1440 pixels in supported themes.

### Edge Cases

- Daylight-saving or timezone offset changes do not duplicate or erase hourly slots; stored instants
  and displayed local times remain unambiguous.
- Daily and monthly date periods use half-open boundaries (`inicio` included, `fin` excluded) so an
  outgoing and incoming occupation can share a boundary without overlap.
- Hourly periods use half-open timestamp boundaries and must have positive duration.
- Manual maintenance/private-use blocks can coexist with Alquiler blocks and participate in
  the same overlap protection without exposing their reason publicly.
- Existing records created before availability blocks exist require an explicit backfill/reporting
  disposition; they are not silently assumed free.
- A change to a Modalidad de precio does not rewrite historical blocks or Alquiler terms.
- Hourly schedules and turnaround buffers are configured per Unidad. A Grupo may provide an
  explicitly enabled common rule inherited only by member Unidades without an individual override;
  the Unidad override has precedence, and moving a Unidad between Grupos requires showing and
  validating which effective rule it will use.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST model availability separately from the manual general state of a
  Unidad; creating, extending, expiring, cancelling, or deleting an Alquiler MUST NOT automatically
  change `Unidad.estado`.
- **FR-002**: Availability MUST support monthly/local-date, daily/local-date, and hourly/local-time
  precision without coercing all three into date-only records.
- **FR-003**: Every availability block MUST belong to one Unidad, include a normalized start and end,
  identify its source category, retain an auditable lifecycle, and support borrado lógico or an
  equivalent non-destructive release history.
- **FR-004**: Monthly and daily periods MUST use explicit local-date boundaries; hourly periods MUST
  use exact instants plus an IANA timezone used for entry and display.
- **FR-004a**: Each hourly Unidad MUST have an effective operating schedule and turnaround buffer.
  It MAY use its own rule or inherit an explicitly enabled common rule from its Grupo; a Unidad rule
  MUST take precedence over the Grupo rule, and the system MUST expose whether the effective value
  is inherited or overridden.
- **FR-004b**: Creating or changing a Grupo rule MUST affect only member Unidades that inherit it,
  MUST preserve individual overrides, and MUST validate existing future blocks before activation so
  the change cannot silently leave an invalid schedule.
- **FR-005**: Periods MUST use half-open overlap semantics so `[A,B)` and `[B,C)` are adjacent rather
  than overlapping, subject to any configured operational buffer.
- **FR-006**: The system MUST reject invalid, zero/negative, below-minimum, and overlapping periods
  before committing an Alquiler/availability change.
- **FR-007**: Overlap prevention MUST be concurrency-safe at the authoritative data layer, not only
  checked in the UI.
- **FR-007a**: All availability blocks for a Unidad MUST conflict globally regardless of the
  Modalidad de precio used to create them; physically independent resources MUST be represented as
  separate Unidades and MAY be organized under one Grupo.
- **FR-008**: Every non-cancelled, non-soft-deleted Alquiler MUST block its complete interval as soon
  as it is registered, regardless of optional Seña, deposit or estado_pago. Financial movements alone
  MUST NOT create, release or alter occupancy; changing/cancelling the Alquiler does so atomically.
  The Unidad's public/manual estado MUST NOT be automatically changed.
- **FR-009**: Extending or changing a blocked Alquiler period MUST preserve the previous valid state
  if the replacement conflicts or fails.
- **FR-010**: Rental cancellation, soft deletion and future manual-block release MUST have explicit
  auditable outcomes; refunding Seña alone MUST NOT release occupancy. No historical Alquiler or
  future operational block may disappear without trace.
- **FR-011**: Gestores and appropriately authorized Delegados MUST be able to create manual
  maintenance/private-use blocks within their permitted scope.
- **FR-012**: Public availability MUST disclose no Gestor-private, Inquilino, payment, Seña amount,
  workspace, or operational-note data.
- **FR-013**: Public clients MUST receive an explicit unknown/error state when authoritative
  availability is absent or unavailable; random or optimistic availability is forbidden.
- **FR-014**: UI interactions and labels MUST adapt to modality: long-period date range, daily/night
  range, or hourly slots, with ES/PT/EN localization on public surfaces.
- **FR-014a**: A published Unidad MUST remain public while any Alquiler is active. If currently
  occupied, show a localized public notice with the exact date/time the continuous occupancy ends,
  in America/Argentina/Buenos_Aires, without private rental data. Future-only reservations MUST
  NOT trigger a current-occupation notice. Missing/error/partial data MUST NOT assert availability.
- **FR-015**: Automated tests MUST cover each modality independently, every overlap shape,
  boundaries, minimum duration, concurrency, lifecycle updates/releases, tenant isolation, public
  privacy, and the invariant that Unidad state remains unchanged.
- **FR-016**: All affected visual interactions MUST be verified separately for desktop web and
  responsive web with Playwright screenshots at 375, 768, 1024, and 1440 pixels in light and dark
  themes where supported.

### Key Entities

- **Modalidad de precio**: Existing commercial option on a Unidad, defined by `unidad_tiempo`,
  `cantidad_tiempo`, and `precio`; it informs minimum duration but is not itself an occupancy record.
- **Availability Block**: A non-overlapping occupied period for one physical Unidad, sourced from
  every registered Alquiler or from future manual maintenance/private-use blocks.
- **Availability Rule**: The precision, timezone, minimum duration, operating schedule, and buffer
  rules used when validating a block. Hourly schedule and buffer are effective per Unidad and may
  be inherited from its Grupo; the Grupo supplies configuration only and never owns occupancy.
- **Effective Seña**: Optional financial concept; collecting or refunding it does not change the
  interval blocked by a registered Alquiler.
- **Alquiler**: Registered contractual occupancy that blocks its exact period regardless of Seña.
  Its date/cancellation/deletion lifecycle affects occupancy without controlling Unidad.estado.
- **Public Availability Projection**: Privacy-safe occupied/free representation derived from blocks
  and rules, with no operational identity or payment data.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of monthly, daily, and hourly acceptance matrices pass independently; no case is
  accepted solely because another modality's rules happen to fit.
- **SC-002**: 100% of positive-duration overlaps are rejected under concurrent and sequential tests;
  100% of valid boundary-adjacent periods are accepted when buffer rules allow them.
- **SC-003**: 100% of registered Alquileres block their intervals regardless of payment or Seña;
  0% of payment/Seña changes alone release a blocked interval. Cancelled and soft-deleted Alquileres
  no longer block future availability, with history retained.
- **SC-004**: 100% of tested Alquiler create/update/expire/cancel/delete flows leave
  `Unidad.estado` unchanged.
- **SC-005**: Public availability responses contain zero private actor, workspace, Alquiler,
  Inquilino, payment, amount, or note fields.
- **SC-006**: No marketplace component uses random availability; missing or failed data produces an
  explicit non-available-for-decision state in 100% of tested cases.
- **SC-007**: Every affected calendar interaction has inspected Playwright evidence at 375, 768,
  1024, and 1440 pixels, with no blocking overflow, clipping, inaccessible target, or theme defect.
- **SC-008**: In group-rule acceptance tests, 100% of inheriting Unidades receive the explicit Grupo
  schedule and buffer, 100% of individual overrides remain unchanged, and 0% of sibling Unidades
  share or transfer occupancy blocks.

## Assumptions

- A Unidad represents one physical rentable resource and has one global occupancy timeline across
  all of its Modalidades de precio. Physically independent resources, such as separate courts, are
  separate Unidades and may share a Grupo; Grupo never owns occupancy, though it may provide an
  explicitly enabled default hourly schedule and buffer for inheriting Unidades.
- Multiple Modalidades de precio may remain active on one Unidad, as the current schema and form
  allow.
- Argentina/Goya is the current operating locale, but storage and display must not prevent later
  regional use.
- Manual calendar management from the governing product document remains in scope alongside
  automatic registered-Alquiler occupancy.
- This feature does not implement online booking or payment processing between public user and
  Gestor; it models trustworthy availability and conflict prevention.
- Native Android remains a future gated feature. Responsive web evidence does not certify native
  Android behavior.
