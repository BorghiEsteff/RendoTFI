"use client";

import * as React from "react";
import { format, isBefore, startOfDay } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { es } from "date-fns/locale";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface DatePickerProps {
  date?: Date;
  setDate: (date?: Date) => void;
  label?: string;
  disabled?: boolean;
  dateFormat?: string;
  minDate?: Date;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
}

export function DatePicker({
  date,
  setDate,
  label = "Elegir fecha",
  disabled,
  dateFormat = "dd/MM/yyyy",
  minDate,
  id,
  invalid,
  describedBy,
}: DatePickerProps) {
  const firstAvailableDay = minDate ? startOfDay(minDate) : undefined;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            id={id}
            data-testid={id ? `date-picker-${id}` : undefined}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            aria-label={date ? `${label}: ${format(date, dateFormat, { locale: es })}` : label}
            disabled={disabled}
            className={cn(
              "min-h-11 w-full justify-start gap-2.5 rounded-lg border-input px-3 text-left text-sm font-medium shadow-sm focus-visible:ring-2 focus-visible:ring-primary/50",
              !date && "text-muted-foreground",
              invalid && "border-destructive"
            )}
          >
            <CalendarIcon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">
              {date ? format(date, dateFormat, { locale: es }) : label}
            </span>
          </Button>
        }
      />
      <PopoverContent
        className="w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-3 shadow-xl"
        align="start"
        sideOffset={8}
      >
        <Calendar
          mode="single"
          selected={date}
          defaultMonth={date && (!firstAvailableDay || !isBefore(startOfDay(date), firstAvailableDay)) ? date : firstAvailableDay}
          startMonth={firstAvailableDay}
          disabled={firstAvailableDay ? { before: firstAvailableDay } : undefined}
          onSelect={(next) => {
            if (!next) return;
            if (firstAvailableDay && isBefore(startOfDay(next), firstAvailableDay)) return;
            setDate(next);
          }}
          locale={es}
          className="w-full"
        />
        {firstAvailableDay && (
          <p className="mt-2 border-t border-border/70 pt-2 text-xs text-muted-foreground">
            Fechas disponibles desde el {format(firstAvailableDay, "dd/MM/yyyy", { locale: es })}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
