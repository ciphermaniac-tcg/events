import com.tcg.pokemon.op.tom.Main;
import com.tcg.pokemon.op.tom.core.Pod;
import com.tcg.pokemon.op.tom.core.Round;
import com.tcg.pokemon.op.tom.core.Tournament;
import com.tcg.pokemon.op.tom.gui.database.TournamentsDatabase;
import java.io.File;

/**
 * tom-tdf's GuiHarness, except every pod's first round is left paired with
 * its pairings viewed, so TOM's main button reads "Start Round".
 * Args: workDir masters
 */
public class StartableHarness {
   public static void main(String[] a) throws Exception {
      File work = new File(a[0]).getAbsoluteFile();
      File home = new File(work, "home");
      GuiHarness.writeInstall(home, new File(work, "TOM_DATA"), 20);
      System.setProperty("user.home", home.getPath());

      Tournament t = GuiHarness.build(Tournament.TournamentMode.LEAGUECHALLENGE, Integer.parseInt(a[1]), 0, 0, 0, 1, 0, false);
      for (Pod pod : t.getPods()) {
         Round round = pod.getCurrentRound();
         if (round.getStage() == 2) {
            round.nextStage();
         }
      }
      File tdf = new File(work, "event.tdf");
      TournamentsDatabase.saveTournament(t, tdf);

      Thread opener = new Thread(() -> GuiHarness.openAfterLogin(tdf, new File(work, "READY")));
      opener.setDaemon(true);
      opener.start();
      Main.main(new String[0]);
   }
}
