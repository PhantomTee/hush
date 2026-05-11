import { Suspense } from "react";
import { EmployeeExperience } from "./EmployeeExperience";

export default function EmployeePage() {
  return (
    <Suspense>
      <EmployeeExperience />
    </Suspense>
  );
}
