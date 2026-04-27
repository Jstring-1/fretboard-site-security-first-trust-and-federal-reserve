<div id="view_src"><button style="background:none;border:none;" type ="button" onclick="viewSource()">View Source Message</button></div><h3 id="info_l">Tuning: <?php if ( $x['z'] == "y" ) { echo "Custom"; } else { echo $x['name']; } ?> :: <?php if ( $x['z'] == "y" ) { echo str_replace( " ", "", $x[$rev.'s'] ); } else { echo str_replace( " ", "", $x[$rev.'notes'] ); } ?> &nbsp; (<?php if ( $x['z'] == "y" ) { echo str_replace( " ", "", $x[$rev.'sdgs'] ); } else { echo str_replace( " ", "", $x[$rev.'dgs'] ); }?>)</h3><div id="print_btn"><button style="background:none;border:none;" onClick="window.print()">Formatted for Printing</button></div><h3 id="info_r">Key: <?php echo $x['k']; ?> :: <?php echo $x['hl_name']; ?></h3><?php
echo "<table id=\"fretboard\">";

for( $a=1; $a<=12; $a++ ) { 	
	if ( $x['z'] == "y" ) {
		$str[$a] = trim( $x['s'.$a] );
	} else {
		$str[$a] = trim( $x['x'.$a] );
	}
}
	

	
	$fretnums = "<tr id='fretnums'><td id=\"f_cyo\" class='fb_sm' >Custom Tuning</td><td id='f0' ".$red_bg_." >X</td><td id='f1'></td><td id='f2'></td><td id='f3'>3</td><td id='f4'></td><td id='f5'>5</td><td id='f6'></td><td id='f7'>7</td><td id='f8'></td><td id='f9'>9</td><td id='f10'></td><td id='f11'></td><td id='f12'>12</td></tr>";
	echo $fretnums;

	for( $a=1; $a<=$x['strs']; $a++ ) {
		$strizzle = $str[$a];

		$c = array_search( strtoupper( $strizzle), $keys, false );

		$search = array_search( strtoupper( $strizzle), $notedegrees, false );
		$search = str_replace( "♭", "b", $search );
		if ( $x['hl_'.$search] == "y" ) {
			$fb_id = str_replace( "♭", "b", array_search( strtoupper( $strizzle), $notedegrees, false ) );
		} else {
			$fb_id="no_highlight";
		} 
		echo "<tr>"; 
		if ( $x['z'] == "n" ) { $f_cyo = "f_cyo_dark"; } else { $f_cyo = "f_cyo"; }
		echo "<td id='".$f_cyo."' ><select class=\"inputs\" name=\"s".$a."\">";   // This is CYO tuning Dropdowns RIGHT HERE -------------------------------------------------------------
		echo "<option value='".urlencode( str_replace( "♯","#", $x['s'.$a] ))."'>".$x['s'.$a]."</option>"; 
		
		foreach ( $allnotes as $note ) {
			echo "<option value='".urlencode( str_replace( "♯","#", $note))."'>".$note."</option>";
		} 
		$nut_id = "_".str_replace( "♭", "b", $fb_id )."_";
		
		echo "</select></td><td class=\"nut\" id=\"".$nut_id."\">".$strizzle."(".array_search( strtoupper( $strizzle), $notedegrees, false ).")</td>";
		
		for ( $b=1; $b<=12; $b++ ) {
			$cb = $c + $b;
			
			$search = array_search( $keys[$cb], $notedegrees, false ); 
			$search = str_replace( "♭", "b", $search );
			if ( $x['hl_'.$search] == "y" ) { 
				$fb_id = str_replace( "♭", "b", array_search( $keys[$cb], $notedegrees, false ) );
			} else { $fb_id = "no_highlight"; } 
			if ( $b == "1" ) { $nut1 = " class=\"nut1\" "; } else { $nut1 = " class=\"fb_td\" "; }
			
			echo "<td ".$nut1." id=\"_".$fb_id."_\">".$keys[$cb]."(".array_search( $keys[$cb], $notedegrees, false ).")</td>";
		}
		echo "</tr>";
	}
	$fretnums = "<tr id='fretnums'><td id='f_cyo' ".$red_bg." ></td><td id='f0' ".$red_bg_." >X</td><td id='f1'></td><td id='f2'></td><td id='f3'>3</td><td id='f4'></td><td id='f5'>5</td><td id='f6'></td><td id='f7'>7</td><td id='f8'></td><td id='f9'>9</td><td id='f10'></td><td id='f11'></td><td id='f12'>12</td></tr>";
	echo $fretnums."</table></form>"; 

	
?>
 