export interface MachineConfig {
  max_v_x: number;
  max_v_y: number;
  max_v_z: number;
  max_a_x: number;
  max_a_y: number;
  max_a_z: number;
  junction_deviation: number;
}

export interface MachiningStatistics {
  totalTimeSec: number;
  cuttingTimeSec: number;
  rapidTimeSec: number;
  staticDelaySec: number;

  totalDistanceMm: number;
  cuttingDistanceMm: number;
  rapidDistanceMm: number;

  totalBlocks: number;
  zPlunges: number;
  mCommandToggles: number;
  arcSegments: number;

  maxAchievedVelocity: number;
  velocityLimitedCorners: number;
}
